import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import PinPad from '../kiosk/PinPad';
import CloudBackground from '../kiosk/CloudBackground';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';

type LoginResponse = {
  token: string;
  user: { id: number; name: string; is_owner: boolean; is_manager: boolean };
};

export default function Login() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  async function submit(pin: string) {
    if (!username.trim()) {
      setErr('Enter your username first.');
      setShake((s) => s + 1);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<LoginResponse>('/manage/login', {
        method: 'POST',
        body: { username: username.trim(), pin },
      });
      setSession(r.token, r.user);
      nav('/manage/today', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setErr(null);
  }, [username]);

  return (
    <div
      className="relative w-full text-creamSoft flex flex-col isolate overflow-hidden"
      style={{ minHeight: '100dvh', height: '100dvh' }}
    >
      <CloudBackground />

      <header
        className="relative z-10 px-4 sm:px-6 pt-4 sm:pt-6 flex justify-between items-center gap-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
          Manager
        </span>
        <a
          href="/"
          className="text-creamSoft/40 hover:text-creamSoft/80 text-xs tracking-[0.18em] uppercase transition-colors"
        >
          Kiosk →
        </a>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 pb-6">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
          className="frosted-pane w-full max-w-[420px] flex flex-col items-center gap-4 sm:gap-6 p-5 sm:p-8 rounded-[1.75rem] sm:rounded-[2rem]"
        >
          <div className="text-center">
            <h1 className="text-[34px] sm:text-[48px] leading-[1.05] tracking-tight font-light">
              Manager <span className="font-serif italic text-cream">sign in</span>
            </h1>
            <p className="mt-1 text-creamSoft/50 text-sm">
              Type your username, then your PIN.
            </p>
          </div>

          <input
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="username"
            className="w-full text-center bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-lg tracking-[0.04em] placeholder:text-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors"
          />

          <PinPad
            onSubmit={submit}
            shake={shake > 0 ? shake : undefined}
            disabled={busy}
          />

          {err && (
            <p className="text-amber-300/90 text-sm text-center">{err}</p>
          )}
        </motion.div>
      </main>

      <footer
        className="relative z-10 px-4 sm:px-6 pb-4 sm:pb-6 text-white text-[10px] sm:text-xs font-bold flex justify-between items-center gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <span className="tracking-[0.2em] uppercase">Glisten Timecard</span>
        <a
          href="/me"
          className="tracking-[0.2em] uppercase hover:text-cream transition-colors"
        >
          My hours
        </a>
      </footer>
    </div>
  );
}
