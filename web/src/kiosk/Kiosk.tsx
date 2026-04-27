import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import PinPad from './PinPad';
import NameReveal from './NameReveal';
import Confirmation from './Confirmation';
import MissedPunchModal from './MissedPunchModal';
import { api, ApiError, LookupResponse, PunchResponse, PunchType } from '../shared/api';
import { getCurrentPosition, greetingForHour } from '../shared/geo';
import { vibrateError } from '../shared/feedback';

type Phase =
  | { kind: 'pin' }
  | { kind: 'matching'; pin: string }
  | { kind: 'name'; pin: string; lookup: LookupResponse }
  | { kind: 'punching'; pin: string; type: PunchType }
  | { kind: 'confirm'; result: PunchResponse; userName: string };

const IDLE_TIMEOUT_MS = 6000;

export default function Kiosk() {
  const [phase, setPhase] = useState<Phase>({ kind: 'pin' });
  const [shake, setShake] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'pending' | 'ready' | 'denied'>('pending');
  const [now, setNow] = useState(new Date());

  const requestGps = useCallback(() => {
    setGpsState('pending');
    getCurrentPosition().then((c) => {
      if (c) {
        setCoords(c);
        setGpsState('ready');
      } else {
        setGpsState('denied');
      }
    });
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
  }, []);

  useEffect(() => {
    if (phase.kind === 'confirm') {
      const t = setTimeout(reset, IDLE_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    if (phase.kind === 'name') {
      const t = setTimeout(reset, 30_000);
      return () => clearTimeout(t);
    }
  }, [phase, reset]);

  async function handlePin(pin: string) {
    setPhase({ kind: 'matching', pin });
    setError(null);
    try {
      const result = await api<LookupResponse>('/kiosk/lookup', {
        method: 'POST',
        body: { pin, lat: coords?.lat, lng: coords?.lng },
      });
      setPhase({ kind: 'name', pin, lookup: result });
    } catch (e) {
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
    if (phase.kind !== 'name') return;
    if (!coords) {
      setError('Location required — allow access and try again.');
      setPhase({ kind: 'pin' });
      return;
    }
    const { pin, lookup } = phase;
    setPhase({ kind: 'punching', pin, type });
    try {
      const result = await api<PunchResponse>('/kiosk/punch', {
        method: 'POST',
        body: { pin, type, lat: coords.lat, lng: coords.lng },
      });
      setPhase({ kind: 'confirm', result, userName: lookup.user.name });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 403
            ? "You're not at a Glisten office — try once you're inside."
            : e.message
          : 'Punch failed.';
      setError(msg);
      setPhase({ kind: 'pin' });
    }
  }

  return (
    <div className="bg-noise min-h-[100dvh] w-full text-creamSoft flex flex-col">
      <Header now={now} />

      <main className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[520px]">
          <AnimatePresence mode="wait">
            {phase.kind === 'pin' || phase.kind === 'matching' ? (
              <motion.div
                key="pin"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="flex flex-col items-center gap-10"
              >
                <Hero />
                {gpsState === 'denied' && (
                  <button
                    type="button"
                    onClick={requestGps}
                    className="rounded-full bg-amber-300/95 text-ink px-4 py-2 text-sm tracking-tight"
                  >
                    Tap to allow location — required to punch
                  </button>
                )}
                <PinPad
                  onSubmit={handlePin}
                  shake={shake > 0 ? shake : undefined}
                  disabled={phase.kind === 'matching'}
                />
                {error && (
                  <p className="text-amber-300/80 text-sm text-center">{error}</p>
                )}
              </motion.div>
            ) : phase.kind === 'name' ? (
              <motion.div
                key="name"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <NameReveal
                  greeting={greetingForHour()}
                  name={phase.lookup.user.name}
                  allowed={phase.lookup.allowed_actions}
                  onChoose={handlePunch}
                  onCancel={reset}
                  onMissedPunch={() => setMissedOpen(true)}
                  geofenceWarning={phase.lookup.location === null}
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

      <footer className="px-6 pb-6 text-creamSoft/30 text-xs flex justify-between items-center">
        <span className="tracking-[0.2em] uppercase">Glisten Timecard</span>
        <div className="flex gap-5">
          <a
            href="/me"
            className="tracking-[0.2em] uppercase hover:text-creamSoft/70 transition-colors"
          >
            My hours
          </a>
          <a
            href="/manage"
            className="tracking-[0.2em] uppercase hover:text-creamSoft/70 transition-colors"
          >
            Manager
          </a>
        </div>
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
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
  return (
    <div className="px-6 pt-6 flex justify-between items-baseline">
      <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
        Glisten Dental
      </span>
      <span className="text-creamSoft/40 text-xs tracking-[0.18em] uppercase tabular-nums">
        {date} · {time}
      </span>
    </div>
  );
}

function Hero() {
  return (
    <div className="text-center">
      <h1 className="text-[40px] sm:text-[52px] leading-[1.05] tracking-tight font-light">
        Welcome <span className="font-serif italic text-cream">back</span>
      </h1>
      <p className="mt-3 text-creamSoft/50 text-base">Enter your 4-digit PIN to clock in.</p>
    </div>
  );
}
