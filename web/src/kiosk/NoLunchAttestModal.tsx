import { useState } from 'react';
import { motion } from 'framer-motion';
import { Coffee, X } from 'lucide-react';

// Pops when an employee tries to clock_out from a 7+ hour shift with
// either no recorded lunch (reasonKind='no_lunch') or a recorded lunch
// shorter than 15 minutes (reasonKind='short_lunch'). They have to type
// a reason before the clock_out records. Reason gets attached to the
// clock_out punch row + lands in Dr. Dawood's Lunch Review queue for
// approve/reject.
type Props = {
  reasonKind: 'no_lunch' | 'short_lunch';
  hoursWorked: number;
  thresholdHours: number;
  lunchMinutes: number | null;
  onSubmit: (reason: string) => Promise<void> | void;
  onCancel: () => void;
};

const QUICK_PICKS_NO_LUNCH = [
  'Too busy with patients',
  'Skipped to leave early',
  'Worked through lunch',
  'Forgot to clock my lunch',
];

const QUICK_PICKS_SHORT_LUNCH = [
  'Patient ran late',
  'Came back early to help',
  'Forgot to clock back in',
  'Slow afternoon, took a quick break',
];

export default function NoLunchAttestModal({
  reasonKind,
  hoursWorked,
  thresholdHours,
  lunchMinutes,
  onSubmit,
  onCancel,
}: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isShort = reasonKind === 'short_lunch';
  const quickPicks = isShort ? QUICK_PICKS_SHORT_LUNCH : QUICK_PICKS_NO_LUNCH;
  const minutesLabel =
    lunchMinutes === 0 ? 'less than a minute' : `${lunchMinutes} minute${lunchMinutes === 1 ? '' : 's'}`;
  const heading = isShort ? (
    <>
      Lunch was <span className="font-serif italic text-cream">too short</span>
    </>
  ) : (
    <>
      No <span className="font-serif italic text-cream">lunch</span> recorded
    </>
  );
  const subhead = isShort
    ? `Lunch was ${minutesLabel} · threshold ${thresholdHours}h shift, ${15} min break minimum`
    : `You've been on the clock for ${hoursWorked.toFixed(1)} hours · threshold ${thresholdHours}h`;
  const prompt = isShort
    ? 'Tell us why your lunch was so short. Your manager will review this with your clock-out.'
    : "Tell us why you didn't take a lunch break. Your manager will see this with your clock-out.";

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 2) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center px-4"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full max-w-[480px] rounded-3xl bg-graphite border border-creamSoft/10 p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lunchAccent text-ink">
              <Coffee size={20} />
            </span>
            <div>
              <h2 className="text-2xl tracking-tight font-light leading-tight">
                {heading}
              </h2>
              <p className="text-creamSoft/55 text-xs mt-0.5">{subhead}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-creamSoft/40 hover:text-creamSoft/80 disabled:opacity-50"
            aria-label="Cancel clock-out"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-creamSoft/80 text-sm mb-3">{prompt}</p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          {quickPicks.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setReason(q)}
              disabled={busy}
              className={[
                'rounded-2xl py-2.5 px-3 text-sm tracking-tight border transition-colors text-left',
                reason === q
                  ? 'bg-lunchAccent/20 border-lunchAccent/40 text-lunchAccent'
                  : 'bg-ink text-creamSoft/75 border-creamSoft/10 hover:border-creamSoft/30',
              ].join(' ')}
            >
              {q}
            </button>
          ))}
        </div>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Type your reason here…"
          disabled={busy}
          className="w-full bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder-creamSoft/30 focus:outline-none focus:border-lunchAccent/40 transition-colors text-sm"
        />

        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-2xl py-3 text-creamSoft/70 hover:bg-creamSoft/5 transition-colors text-sm tracking-tight"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || reason.trim().length < 2}
            className="flex-[2] rounded-2xl py-3 bg-cream text-ink hover:bg-cream/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm tracking-tight font-medium"
          >
            {busy ? 'Clocking out…' : 'Submit & clock out'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
