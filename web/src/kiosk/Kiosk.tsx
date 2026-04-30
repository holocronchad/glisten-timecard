import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import PinPad from './PinPad';
import NameReveal from './NameReveal';
import Confirmation from './Confirmation';
import MissedPunchModal from './MissedPunchModal';
import RegisterModal from './RegisterModal';
import CloudBackground from './CloudBackground';
import {
  api,
  ApiError,
  EmployeeLookup,
  LookupResponse,
  PunchResponse,
  PunchType,
} from '../shared/api';
import { getCurrentPosition, geoPermissionState, greetingForHour, type GeoError } from '../shared/geo';
import { vibrateError } from '../shared/feedback';

// Must match STORAGE_KEY in src/manage/auth.tsx so AuthProvider picks it up
// when the kiosk routes a manager into /manage.
const SESSION_TOKEN_KEY = 'glisten-timecard-manager';

type Phase =
  | { kind: 'pin' }
  | { kind: 'matching'; pin: string }
  | { kind: 'name'; pin: string; lookup: EmployeeLookup }
  | { kind: 'punching'; pin: string; type: PunchType }
  | { kind: 'confirm'; result: PunchResponse; userName: string };

const IDLE_TIMEOUT_MS = 6000;
// Time the user has on the name-reveal screen to tap a punch button before
// auto-reset. Was 30s through 2026-04-29 — too short, ~5 employees lost
// their lunch click that day because they got bounced to the PIN pad
// mid-decision and tapped where the lunch button used to be (registering
// as a stray PIN digit). Bumped to 90s + countdown indicator below 30s.
const NAME_PHASE_TIMEOUT_MS = 90_000;
const NAME_PHASE_WARN_AT_MS = 30_000;
const CONFIRM_PHASE_TIMEOUT_MS = 6000;

export default function Kiosk() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'pin' });
  const [shake, setShake] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'pending' | 'ready' | 'denied'>('pending');
  const [gpsError, setGpsError] = useState<GeoError | null>(null);
  const [now, setNow] = useState(new Date());
  const [registerOpenForPin, setRegisterOpenForPin] = useState<string | null>(null);

  const requestGps = useCallback(async () => {
    setGpsState('pending');
    setGpsError(null);
    // Check if the browser has already cached a 'denied' decision — if so,
    // calling getCurrentPosition won't re-prompt. We surface that state
    // distinctly so the UI can tell the user to fix it in browser settings.
    const perm = await geoPermissionState();
    if (perm === 'denied') {
      setGpsError('denied');
      setGpsState('denied');
      return;
    }
    const r = await getCurrentPosition();
    if (r.ok) {
      setCoords(r.coords);
      setGpsState('ready');
    } else {
      setGpsError(r.reason);
      setGpsState('denied');
    }
  }, []);

  useEffect(() => {
    requestGps();
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [requestGps]);

  const [missedOpen, setMissedOpen] = useState(false);
  const [missedConfirm, setMissedConfirm] = useState(false);

  const reset = useCallback(() => {
    setPhase({ kind: 'pin' });
    setError(null);
    setMissedOpen(false);
    setMissedConfirm(false);
    setRegisterOpenForPin(null);
  }, []);

  // Auto-reset countdown — tracks remaining ms so the UI can show a warning
  // when the user is about to be bounced back to the PIN screen mid-decision.
  const [nameCountdownMs, setNameCountdownMs] = useState<number | null>(null);

  useEffect(() => {
    if (phase.kind === 'confirm') {
      const t = setTimeout(reset, CONFIRM_PHASE_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    if (phase.kind === 'name') {
      const start = Date.now();
      setNameCountdownMs(NAME_PHASE_TIMEOUT_MS);
      const tick = setInterval(() => {
        const remaining = NAME_PHASE_TIMEOUT_MS - (Date.now() - start);
        setNameCountdownMs(remaining > 0 ? remaining : 0);
      }, 1000);
      const t = setTimeout(reset, NAME_PHASE_TIMEOUT_MS);
      return () => {
        clearTimeout(t);
        clearInterval(tick);
        setNameCountdownMs(null);
      };
    }
    setNameCountdownMs(null);
    return undefined;
  }, [phase, reset]);

  async function handlePin(pin: string) {
    setPhase({ kind: 'matching', pin });
    setError(null);
    try {
      const result = await api<LookupResponse>('/kiosk/lookup', {
        method: 'POST',
        body: { pin, lat: coords?.lat, lng: coords?.lng },
      });
      // Manager / owner — store JWT and route to manager portal.
      if (result.kind === 'manager') {
        try {
          localStorage.setItem(
            SESSION_TOKEN_KEY,
            JSON.stringify({ token: result.token, user: result.user }),
          );
        } catch {
          // no-op if storage unavailable
        }
        nav('/manage/today', { replace: true });
        return;
      }
      // Standard employee path
      setPhase({ kind: 'name', pin, lookup: result });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Unknown PIN → offer self-register flow.
        setRegisterOpenForPin(pin);
        setPhase({ kind: 'pin' });
        return;
      }
      const msg =
        e instanceof ApiError
          ? e.status === 429
            ? 'Too many attempts — please ask a manager.'
            : e.status === 401
              ? 'PIN not recognized.'
              : e.status === 403
                ? 'This account does not punch the clock.'
                : e.message
          : 'Connection failed.';
      setError(msg);
      setShake((s) => s + 1);
      vibrateError();
      setPhase({ kind: 'pin' });
    }
  }

  async function handlePunch(type: PunchType) {
    // Click-instrumentation: log every tap so future silent failures are
    // diagnosable. (Local console only; cheap, privacy-safe.)
    // eslint-disable-next-line no-console
    console.info('[kiosk] punch tap', {
      type,
      phase: phase.kind,
      hasCoords: !!coords,
      gpsState,
      ts: new Date().toISOString(),
    });

    // 30s race: user tapped a button on the name screen exactly as the
    // auto-reset fired. We caught it in React state — phase is no longer
    // 'name' — but rather than silently swallow, surface clearly so
    // they know to re-enter PIN and try again.
    if (phase.kind !== 'name') {
      setError('That session timed out — please re-enter your PIN.');
      return;
    }

    const { pin, lookup } = phase;

    // GPS not yet ready — try ONE more time before failing the click.
    // Previously we bounced straight to the PIN screen with a vague error;
    // that swallowed legitimate clicks if GPS was mid-acquisition.
    let punchCoords = coords;
    if (!punchCoords) {
      setPhase({ kind: 'punching', pin, type });
      const r = await getCurrentPosition();
      if (r.ok) {
        punchCoords = r.coords;
        setCoords(r.coords);
        setGpsState('ready');
      } else {
        setError(
          r.reason === 'denied'
            ? 'Location access blocked — tap the lock icon in your address bar → allow location, then try again.'
            : "Couldn't get your location — make sure WiFi is on and try again.",
        );
        setPhase({ kind: 'name', pin, lookup }); // stay on the buttons screen
        return;
      }
    }

    setPhase({ kind: 'punching', pin, type });
    try {
      const result = await api<PunchResponse>('/kiosk/punch', {
        method: 'POST',
        body: { pin, type, lat: punchCoords.lat, lng: punchCoords.lng },
      });
      // eslint-disable-next-line no-console
      console.info('[kiosk] punch ok', { id: result.punch.id, type: result.punch.type });
      setPhase({ kind: 'confirm', result, userName: lookup.user.name });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[kiosk] punch failed', e);
      const msg =
        e instanceof ApiError
          ? e.status === 403
            ? "You're not at a Glisten office — try once you're inside."
            : e.status === 409
              ? "Looks like you already did that. Take a look at the screen and try the other button."
              : e.message
          : 'Punch failed — please try again.';
      setError(msg);
      // Stay on the buttons screen so they can retry. Was: bounce to PIN,
      // which lost the session and let users tap the wrong place next.
      setPhase({ kind: 'name', pin, lookup });
    }
  }

  async function handleRegistered(pin: string, _name: string) {
    setRegisterOpenForPin(null);
    // Re-run the lookup so we land in the regular employee flow with CPR
    // panel + clock-in options. The user is now in the DB with approved=false.
    await handlePin(pin);
  }

  return (
    <div
      className="relative w-full text-creamSoft flex flex-col isolate overflow-hidden"
      style={{ minHeight: '100dvh', height: '100dvh' }}
    >
      <CloudBackground />
      <div className="relative z-10">
        <Header now={now} />
      </div>

      {/* Top-right corner shortcut links — fixed position so they are
          always reachable, even when main content (PIN pad / GPS warnings)
          is tall enough to push the footer below the viewport. */}
      <div
        className="fixed z-20 flex gap-1.5 right-3 sm:right-5"
        style={{ top: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <a
          href="/me"
          className="text-white/85 hover:text-white text-[11px] sm:text-xs font-bold tracking-[0.2em] uppercase px-3 py-2 rounded-full bg-black/25 hover:bg-black/40 backdrop-blur-sm transition-colors"
        >
          My hours
        </a>
        <a
          href="/manage"
          className="text-white/85 hover:text-white text-[11px] sm:text-xs font-bold tracking-[0.2em] uppercase px-3 py-2 rounded-full bg-black/25 hover:bg-black/40 backdrop-blur-sm transition-colors"
        >
          Manager
        </a>
      </div>

      <main className="relative z-10 flex-1 flex items-center justify-center px-3 sm:px-6 pb-4 sm:pb-10 min-w-0">
        <div className="w-full max-w-[520px] min-w-0">
          <AnimatePresence mode="wait">
            {phase.kind === 'pin' || phase.kind === 'matching' ? (
              <motion.div
                key="pin"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="frosted-pane w-full flex flex-col items-center gap-4 sm:gap-8 p-5 sm:p-8 rounded-[1.75rem] sm:rounded-[2rem]"
              >
                <Hero />
                {gpsState === 'denied' && (
                  <div className="flex flex-col items-center gap-2 max-w-[420px]">
                    <button
                      type="button"
                      onClick={requestGps}
                      className="rounded-full bg-amber-300/95 text-ink px-4 py-2 text-xs sm:text-sm tracking-tight max-w-full whitespace-normal text-center leading-snug"
                    >
                      Tap to allow location to punch
                    </button>
                    {gpsError === 'denied' && (
                      <p className="text-amber-300/80 text-[11px] text-center leading-snug px-4">
                        Browser blocked location for this site. Tap the lock icon in
                        the address bar → Site settings → Location → Allow, then
                        reload.
                      </p>
                    )}
                    {gpsError === 'unavailable' && (
                      <p className="text-amber-300/80 text-[11px] text-center leading-snug px-4">
                        Couldn't get a GPS fix. Make sure WiFi/Bluetooth are on
                        (helps positioning) and try again.
                      </p>
                    )}
                    {gpsError === 'timeout' && (
                      <p className="text-amber-300/80 text-[11px] text-center leading-snug px-4">
                        Location lookup timed out. Try again or step closer to a window.
                      </p>
                    )}
                  </div>
                )}
                <PinPad
                  onSubmit={handlePin}
                  shake={shake > 0 ? shake : undefined}
                  disabled={phase.kind === 'matching'}
                />
                {error && (
                  <p className="text-amber-300/80 text-sm text-center">{error}</p>
                )}
                <button
                  type="button"
                  onClick={() => setRegisterOpenForPin('')}
                  className="text-creamSoft/45 hover:text-creamSoft/80 text-xs tracking-[0.18em] uppercase transition-colors"
                >
                  New employee? Set up your PIN
                </button>
              </motion.div>
            ) : phase.kind === 'name' ? (
              <motion.div
                key="name"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="frosted-pane p-7 sm:p-9 rounded-[2rem]"
              >
                <NameReveal
                  pin={phase.pin}
                  greeting={greetingForHour()}
                  name={phase.lookup.user.name}
                  approved={phase.lookup.user.approved}
                  cpr={phase.lookup.cpr}
                  allowed={phase.lookup.allowed_actions}
                  onChoose={handlePunch}
                  onCancel={reset}
                  onMissedPunch={() => setMissedOpen(true)}
                  geofenceWarning={phase.lookup.location === null}
                  countdownMs={
                    nameCountdownMs !== null && nameCountdownMs <= NAME_PHASE_WARN_AT_MS
                      ? nameCountdownMs
                      : null
                  }
                />
              </motion.div>
            ) : phase.kind === 'punching' ? (
              <motion.div
                key="punching"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-creamSoft/60 text-sm"
              >
                Recording your punch…
              </motion.div>
            ) : (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="frosted-pane p-10 sm:p-12 rounded-[2rem]"
              >
                <Confirmation
                  type={phase.result.punch.type}
                  ts={phase.result.punch.ts}
                  name={phase.userName}
                  greeting={phase.result.message}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer
        className="relative z-10 shrink-0 px-4 sm:px-6 pt-3 text-white text-[11px] sm:text-xs font-bold flex justify-center items-center gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <span className="tracking-[0.2em] uppercase">Glisten Timecard</span>
      </footer>

      <AnimatePresence>
        {missedOpen && phase.kind === 'name' && (
          <MissedPunchModal
            pin={phase.pin}
            onClose={() => setMissedOpen(false)}
            onSubmitted={() => {
              setMissedOpen(false);
              setMissedConfirm(true);
              setTimeout(() => {
                setMissedConfirm(false);
                reset();
              }, 2400);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {registerOpenForPin !== null && (
          <RegisterModal
            initialPin={registerOpenForPin}
            coords={coords}
            gpsError={gpsError}
            onRequestGps={requestGps}
            onClose={() => setRegisterOpenForPin(null)}
            onRegistered={handleRegistered}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {missedConfirm && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 bg-cream text-ink rounded-full px-5 py-2.5 text-sm tracking-tight shadow-2xl z-40"
          >
            Request sent — a manager will review it.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header({ now }: { now: Date }) {
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
  const dateLong = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
  const dateShort = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
  return (
    <div
      className="px-4 sm:px-6 pt-4 sm:pt-6 flex justify-between items-center gap-3"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
    >
      <img
        src="/glisten-logo.png"
        alt="Glisten Dental"
        className="h-7 sm:h-12 w-auto select-none shrink min-w-0 max-w-[55%] sm:max-w-none object-contain object-left"
        draggable={false}
      />
      <span className="text-white text-[10px] sm:text-sm tracking-[0.12em] sm:tracking-[0.18em] uppercase tabular-nums text-right shrink whitespace-nowrap">
        <span className="sm:hidden">{dateShort} · {time}</span>
        <span className="hidden sm:inline">{dateLong} · {time}</span>
      </span>
    </div>
  );
}

function Hero() {
  return (
    <div className="text-center">
      <h1 className="text-[34px] sm:text-[52px] leading-[1.05] tracking-tight font-light">
        Welcome <span className="font-serif italic text-cream">back</span>
      </h1>
      <p className="mt-2 sm:mt-3 text-creamSoft/50 text-sm sm:text-base">
        Enter your 4-digit PIN to clock in.
      </p>
    </div>
  );
}
