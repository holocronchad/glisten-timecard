import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';

type Props = {
  onSubmit: (pin: string) => void;
  shake?: number;
  disabled?: boolean;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export default function PinPad({ onSubmit, shake, disabled }: Props) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (shake) setPin('');
  }, [shake]);

  useEffect(() => {
    if (pin.length === 4 && !disabled) {
      onSubmit(pin);
    }
  }, [pin, disabled, onSubmit]);

  function press(k: string) {
    if (disabled) return;
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (k === '') return;
    setPin((p) => (p.length >= 4 ? p : p + k));
  }

  return (
    <div className="flex flex-col items-center gap-5 sm:gap-10 w-full">
      <motion.div
        key={`dots-${shake ?? 0}`}
        className="flex gap-3 sm:gap-4"
        animate={shake ? { x: [-8, 8, -6, 6, -3, 3, 0] } : {}}
        transition={{ duration: 0.45 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Dot key={i} filled={i < pin.length} />
        ))}
      </motion.div>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 w-full max-w-[280px] sm:max-w-[320px]">
        {KEYS.map((k, i) => (
          <Key key={i} label={k} onPress={() => press(k)} />
        ))}
      </div>
    </div>
  );
}

function Dot({ filled }: { filled: boolean }) {
  return (
    <motion.div
      className="h-3 w-3 rounded-full border border-creamSoft/40"
      animate={{
        backgroundColor: filled ? '#DEDBC8' : 'rgba(0,0,0,0)',
        scale: filled ? 1.1 : 1,
      }}
      transition={{ duration: 0.18 }}
    />
  );
}

function Key({ label, onPress }: { label: string; onPress: () => void }) {
  if (label === '') return <div />;
  const isDel = label === 'del';
  return (
    <motion.button
      type="button"
      onClick={onPress}
      whileTap={{ scale: 0.94 }}
      whileHover={{ scale: 1.03, backgroundColor: 'rgba(222, 219, 200, 0.10)' }}
      transition={{ duration: 0.15 }}
      style={{
        backgroundColor: 'rgba(222, 219, 200, 0.05)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
      className={[
        'pin-key h-14 sm:h-20 rounded-xl sm:rounded-2xl border border-creamSoft/15',
        'text-creamSoft text-2xl sm:text-3xl font-light tracking-tight',
        'flex items-center justify-center select-none',
        'shadow-[inset_0_1px_0_rgba(222,219,200,0.08),0_8px_32px_-12px_rgba(0,0,0,0.6)]',
      ].join(' ')}
    >
      {isDel ? <Delete size={22} /> : label}
    </motion.button>
  );
}
