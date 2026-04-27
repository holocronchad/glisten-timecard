import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: 'cream' | 'outline';
};

export default function PillButton({
  label,
  variant = 'cream',
  className = '',
  ...rest
}: Props) {
  const isCream = variant === 'cream';
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      {...(rest as any)}
      className={[
        'group inline-flex items-center gap-3 rounded-full pl-7 pr-2 py-2 select-none',
        isCream
          ? 'bg-cream text-ink'
          : 'border border-creamSoft/30 text-creamSoft hover:bg-creamSoft/5',
        'transition-colors',
        className,
      ].join(' ')}
    >
      <span className="text-[15px] tracking-tight font-medium">{label}</span>
      <span
        className={[
          'flex h-9 w-9 items-center justify-center rounded-full',
          isCream ? 'bg-ink text-cream' : 'bg-cream text-ink',
          'transition-transform group-hover:translate-x-0.5',
        ].join(' ')}
      >
        <ArrowRight size={16} />
      </span>
    </motion.button>
  );
}
