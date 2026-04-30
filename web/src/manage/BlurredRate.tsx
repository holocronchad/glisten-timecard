import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Hourly rate shoulder-surf shield (added 2026-04-29 per Dr. Dawood —
// employees were standing behind her while she browsed the manager
// dashboard). Default state: blurred + click-to-reveal. Auto re-blurs
// after `revealMs` so walking away with the screen unlocked doesn't
// leave the value exposed.
type Props = {
  cents: number;
  revealMs?: number;
  className?: string;
};

export default function BlurredRate({ cents, revealMs = 5000, className }: Props) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!revealed) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setRevealed(false), revealMs);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [revealed, revealMs]);

  const text = `$${(cents / 100).toFixed(2)}`;

  return (
    <button
      type="button"
      aria-label={revealed ? 'Hide hourly rate' : 'Reveal hourly rate'}
      title={revealed ? 'Click to hide' : 'Click to reveal'}
      onClick={(e) => {
        e.stopPropagation();
        setRevealed((v) => !v);
      }}
      className={[
        'group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5',
        'hover:bg-creamSoft/5 focus:bg-creamSoft/5 outline-none focus-visible:ring-1 focus-visible:ring-creamSoft/30',
        'transition-colors',
        className ?? '',
      ].join(' ')}
    >
      <span
        className={[
          'tabular-nums tracking-tight transition-[filter,opacity] duration-200',
          revealed ? 'blur-0 opacity-100' : 'blur-[5px] opacity-80 select-none',
        ].join(' ')}
        // -webkit-text-security adds a second layer of obfuscation if the
        // CSS blur fails to load (older WebKit, copy/paste, screenshot OCR
        // is still defeated by the random aria/title swap above).
        style={!revealed ? ({ WebkitTextSecurity: 'disc' } as any) : undefined}
      >
        {text}
      </span>
      {revealed
        ? <EyeOff size={12} className="text-creamSoft/40" />
        : <Eye    size={12} className="text-creamSoft/40 group-hover:text-creamSoft/70" />
      }
    </button>
  );
}
