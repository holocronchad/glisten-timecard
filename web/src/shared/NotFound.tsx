import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const nav = useNavigate();
  return (
    <div className="bg-noise min-h-[100dvh] flex items-center justify-center px-6">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
        className="text-center max-w-[460px]"
      >
        <p className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
          Glisten Timecard
        </p>
        <h1 className="mt-4 text-[64px] sm:text-[88px] leading-[1] tracking-tight font-light text-creamSoft">
          <span className="font-serif italic text-cream">Not</span> here
        </h1>
        <p className="mt-3 text-creamSoft/50 text-base">
          That page doesn't exist. Maybe a typo, or the link is stale.
        </p>
        <button
          onClick={() => nav('/', { replace: true })}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-cream text-ink px-5 py-2.5 text-sm tracking-tight"
        >
          <ArrowLeft size={14} /> Back to the kiosk
        </button>
      </motion.div>
    </div>
  );
}
