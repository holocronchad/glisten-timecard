import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, ApiError, RegisterResponse, RegisterSuggestion } from '../shared/api';
import type { GeoError } from '../shared/geo';

type Props = {
  initialPin: string;
  coords: { lat: number; lng: number } | null;
  gpsError: GeoError | null;
  onRequestGps: () => void;
  onClose: () => void;
  onRegistered: (pin: string, name: string) => void;
};

type Step = 'form' | 'submitting' | 'suggest';

export default function RegisterModal({
  initialPin,
  coords,
  gpsError,
  onRequestGps,
  onClose,
  onRegistered,
}: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pin, setPin] = useState(initialPin);
  const [pinConfirm, setPinConfirm] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<RegisterSuggestion | null>(null);

  async function postRegister(extra: {
    confirm_user_id?: number;
    force_self_register?: boolean;
  } = {}) {
    if (!coords) {
      // No GPS yet — re-request permission and bail. The GPS callback will
      // populate coords; user re-submits.
      onRequestGps();
      setError('Allow location access in your browser, then tap Create again.');
      setStep('form');
      return;
    }
    setStep('submitting');
    setError(null);
    try {
      const r = await api<RegisterResponse>('/kiosk/register', {
        method: 'POST',
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          pin,
          lat: coords.lat,
          lng: coords.lng,
          ...extra,
        },
      });
      if ('suggestion' in r && r.suggestion) {
        setSuggestion(r.suggestion);
        setStep('suggest');
        return;
      }
      if ('user' in r && r.user) {
        onRegistered(pin, r.user.name);
        return;
      }
      setError('Unexpected response.');
      setStep('form');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 409
            ? e.code === 'Multiple matches'
              ? 'More than one record matches — please ask a manager.'
              : 'That PIN is already taken — pick a different one.'
            : e.status === 403
              ? 'You can only register from inside a Glisten Dental office.'
              : e.message
          : 'Registration failed.';
      setError(msg);
      setStep('form');
    }
  }

  function submit() {
    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter your first and last name.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be 4 digits.');
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs don't match.");
      setStep('form');
      return;
    }
    postRegister();
  }

  function confirmSuggestion(yes: boolean) {
    if (!suggestion) return;
    if (yes) {
      postRegister({ confirm_user_id: suggestion.id });
    } else {
      // Employee says "no, that's not me" → register as a fresh
      // self-registered approved=false account, manager will approve.
      postRegister({ force_self_register: true });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-30 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(10, 10, 10, 0.7)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="frosted-pane w-full max-w-[460px] p-7 sm:p-8 rounded-[1.75rem] sm:rounded-[2rem]"
      >
        <div className="text-center">
          <h2 className="text-[28px] sm:text-[36px] leading-[1.1] tracking-tight font-light">
            New <span className="font-serif italic text-cream">employee</span>
          </h2>
          <p className="mt-2 text-creamSoft/55 text-sm">
            {step === 'suggest'
              ? 'We found a close match in our roster.'
              : "Set up your timecard. Just first name, last name, and a 4-digit PIN you'll remember."}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {step === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 flex flex-col gap-3"
            >
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                autoFocus
                autoComplete="off"
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-base focus:outline-none focus:border-cream/40 transition-colors"
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                autoComplete="off"
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-base focus:outline-none focus:border-cream/40 transition-colors"
              />
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="PIN (4 digits)"
                autoComplete="off"
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-lg tracking-[0.5em] text-center focus:outline-none focus:border-cream/40 transition-colors"
              />
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Re-enter PIN"
                autoComplete="off"
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-lg tracking-[0.5em] text-center focus:outline-none focus:border-cream/40 transition-colors"
              />

              {!coords && (
                <div className="flex flex-col gap-2 mt-1">
                  <button
                    type="button"
                    onClick={onRequestGps}
                    className="w-full rounded-full bg-amber-300/95 text-ink px-4 py-2.5 text-sm tracking-tight font-bold"
                  >
                    Tap to allow location
                  </button>
                  {gpsError === 'denied' && (
                    <p className="text-amber-300/85 text-[11px] text-center leading-snug px-2">
                      Your browser is blocking location for this site. Tap the
                      lock icon in the address bar → Site settings → Location
                      → <strong>Allow</strong>, then reload this page.
                    </p>
                  )}
                  {gpsError === 'unavailable' && (
                    <p className="text-amber-300/85 text-[11px] text-center leading-snug px-2">
                      Couldn't get a GPS fix. Try near a window or with WiFi on.
                    </p>
                  )}
                  {gpsError === 'timeout' && (
                    <p className="text-amber-300/85 text-[11px] text-center leading-snug px-2">
                      Location lookup timed out. Tap again.
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p className="text-amber-300/90 text-sm text-center mt-1">{error}</p>
              )}

              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full px-4 py-3 text-creamSoft/60 hover:text-creamSoft text-sm tracking-tight border border-creamSoft/15 hover:border-creamSoft/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!firstName || !lastName || pin.length !== 4 || pinConfirm.length !== 4 || !coords}
                  className="flex-1 rounded-full px-4 py-3 bg-cream text-ink text-sm tracking-tight font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Create my account
                </button>
              </div>
            </motion.div>
          )}

          {step === 'submitting' && (
            <motion.div
              key="submitting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 text-center text-creamSoft/60 text-sm"
            >
              Setting you up…
            </motion.div>
          )}

          {step === 'suggest' && suggestion && (
            <motion.div
              key="suggest"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 flex flex-col gap-3"
            >
              <div className="rounded-2xl border border-creamSoft/15 bg-creamSoft/5 px-5 py-4 text-center">
                <div className="text-creamSoft/60 text-xs tracking-[0.18em] uppercase mb-1">
                  {suggestion.reason === 'fuzzy' ? 'Did you mean' : 'Are you'}
                </div>
                <div className="text-creamSoft text-2xl tracking-tight font-serif italic">
                  {suggestion.name}
                </div>
                {suggestion.role && (
                  <div className="text-creamSoft/40 text-xs mt-1 tracking-tight">
                    {suggestion.role.replace(/_/g, ' ')}
                  </div>
                )}
              </div>

              <p className="text-creamSoft/45 text-xs text-center leading-relaxed">
                You typed <span className="text-creamSoft/70">"{firstName} {lastName}"</span>.
                Confirm to claim this account, or "Not me" to register as a new person.
              </p>

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => confirmSuggestion(false)}
                  className="flex-1 rounded-full px-4 py-3 text-creamSoft/60 hover:text-creamSoft text-sm tracking-tight border border-creamSoft/15 hover:border-creamSoft/30 transition-colors"
                >
                  Not me
                </button>
                <button
                  type="button"
                  onClick={() => confirmSuggestion(true)}
                  className="flex-1 rounded-full px-4 py-3 bg-cream text-ink text-sm tracking-tight font-bold"
                >
                  Yes, that's me
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </motion.div>
  );
}
