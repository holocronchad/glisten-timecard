import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';

type LoginResponse = {
  token: string;
  user: { id: number; name: string; is_owner: boolean; is_manager: boolean };
};

export default function Login() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<LoginResponse>('/manage/login', {
        method: 'POST',
        body: { email, password },
      });
      setSession(r.token, r.user);
      nav('/manage/today', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-noise min-h-[100dvh] flex items-center justify-center px-6">
      <motion.form
        onSubmit={submit}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full max-w-[420px] flex flex-col gap-6"
      >
        <div>
          <p className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
            Glisten Timecard
          </p>
          <h1 className="mt-3 text-[44px] leading-[1.05] tracking-tight font-light text-creamSoft">
            Manager <span className="font-serif italic text-cream">sign in</span>
          </h1>
        </div>

        <div className="flex flex-col gap-3">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoFocus
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
          />
        </div>

        {err && <p className="text-amber-300/80 text-sm">{err}</p>}

        <motion.button
          type="submit"
          disabled={busy || !email || !password}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="group inline-flex items-center justify-between rounded-full bg-cream text-ink pl-7 pr-2 py-2 disabled:opacity-50"
        >
          <span className="text-[15px] tracking-tight font-medium">
            {busy ? 'Signing in…' : 'Sign in'}
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-cream group-hover:translate-x-0.5 transition-transform">
            <ArrowRight size={16} />
          </span>
        </motion.button>

        <a
          href="/"
          className="text-creamSoft/40 hover:text-creamSoft/70 text-sm tracking-tight"
        >
          ← Back to kiosk
        </a>
      </motion.form>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="bg-graphite/70 border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder:text-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors"
      />
    </label>
  );
}
