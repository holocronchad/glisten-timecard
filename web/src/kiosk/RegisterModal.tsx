import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, ApiError, RegisterResponse } from '../shared/api';

type Props = {
  initialPin: string;
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
  onRegistered: (pin: string, name: string) => void;
};

type Step = 'form' | 'confirm-pin' | 'submitting';

export default function RegisterModal({ initialPin, coords, onClose, onRegistered }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pin, setPin] = useState(initialPin);
  const [pinConfirm, setPinConfirm] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
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
    if (!coords) {
      setError('Location is required to register a new employee.');
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
        },
      });
      onRegistered(pin, r.user.name);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 409
            ? 'That PIN is already taken — pick a different one.'
            : e.status === 403
              ? 'You can only register from inside a Glisten Dental office.'
              : e.message
          : 'Registration failed.';
      setError(msg);
      setStep('form');
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
            Set up your timecard. Just first name, last name, and a 4-digit PIN you'll remember.
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
                  disabled={!firstName || !lastName || pin.length !== 4 || pinConfirm.length !== 4}
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
        </AnimatePresence>

        <p className="mt-6 text-creamSoft/35 text-[11px] text-center leading-relaxed">
          A manager will approve your account before your first paycheck. Your time is recorded starting now.
        </p>
      </motion.div>
    </motion.div>
  );
}
