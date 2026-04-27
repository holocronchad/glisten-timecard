import { motion } from 'framer-motion';
import { LogIn, LogOut, Coffee, Utensils } from 'lucide-react';
import { PunchType } from '../shared/api';

type Props = {
  greeting: string;
  name: string;
  allowed: PunchType[];
  onChoose: (type: PunchType) => void;
  onCancel: () => void;
  geofenceWarning?: boolean;
};

const META: Record<PunchType, { label: string; sub: string; icon: any }> = {
  clock_in: { label: 'Clock in', sub: 'Start your day', icon: LogIn },
  clock_out: { label: 'Clock out', sub: 'End your day', icon: LogOut },
  lunch_start: { label: 'Start lunch', sub: 'Take a break', icon: Coffee },
  lunch_end: { label: 'End lunch', sub: 'Back to work', icon: Utensils },
};

export default function NameReveal({
  greeting,
  name,
  allowed,
  onChoose,
  onCancel,
  geofenceWarning,
}: Props) {
  const first = name.split(' ')[0];

  return (
    <div className="flex flex-col items-center gap-10 w-full">
      <div className="text-center">
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
          className="text-[44px] sm:text-[56px] leading-[1.05] tracking-tight font-light text-creamSoft"
        >
          {greeting},{' '}
          <span className="font-serif italic text-cream">{first}</span>
        </motion.h1>
        <motion.p
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-3 text-creamSoft/60 text-base"
        >
          What would you like to do?
        </motion.p>
      </div>

      {geofenceWarning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-amber-300/80 text-sm bg-amber-950/30 border border-amber-300/20 rounded-full px-4 py-2"
        >
          You're outside the office geofence — your punch will be flagged for review.
        </motion.div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[480px]">
        {allowed.map((t, i) => {
          const m = META[t];
          const Icon = m.icon;
          return (
            <motion.button
              key={t}
              type="button"
              onClick={() => onChoose(t)}
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.07 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={[
                'group flex items-center gap-4 p-5 rounded-3xl text-left',
                'bg-graphite/70 hover:bg-graphite border border-creamSoft/10',
                'transition-colors',
              ].join(' ')}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream text-ink">
                <Icon size={20} />
              </span>
              <span className="flex flex-col">
                <span className="text-creamSoft text-lg tracking-tight">{m.label}</span>
                <span className="text-creamSoft/50 text-sm">{m.sub}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="text-creamSoft/40 hover:text-creamSoft/70 text-sm tracking-tight transition-colors"
      >
        That's not me — cancel
      </button>
    </div>
  );
}
