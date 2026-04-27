import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { PunchType } from '../shared/api';
import { formatTime } from '../shared/geo';

const VERB: Record<PunchType, string> = {
  clock_in: 'Clocked in',
  clock_out: 'Clocked out',
  lunch_start: 'Lunch started',
  lunch_end: 'Lunch ended',
};

type Props = {
  type: PunchType;
  ts: string;
  name: string;
  greeting: string;
};

export default function Confirmation({ type, ts, name, greeting }: Props) {
  const first = name.split(' ')[0];
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1.36, 0.36, 1] }}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-cream text-ink"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.35, delay: 0.25 }}
        >
          <Check size={42} strokeWidth={2.5} />
        </motion.div>
      </motion.div>

      <div>
        <motion.h2
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-light text-creamSoft"
        >
          {VERB[type]} at{' '}
          <span className="font-serif italic text-cream">{formatTime(ts)}</span>
        </motion.h2>
        <motion.p
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-3 text-creamSoft/60"
        >
          {greeting.replace('{name}', first)}
        </motion.p>
      </div>
    </div>
  );
}
