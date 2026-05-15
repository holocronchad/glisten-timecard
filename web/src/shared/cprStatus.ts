// CPR cert status bucket — shared between manager Staff list, EmployeeDetail
// card, and any other surface that needs a one-glance verdict. Kiosk has its
// own copy in kiosk/CprPanel.tsx because its tones (frosted backgrounds) and
// copy ("CPR cert — not on file" with onboarding CTA) are tuned for the
// kiosk's first-touch flow; manager surfaces want compact pill copy instead.

export type CprBucket = 'missing' | 'expired' | 'expiring_soon' | 'expiring' | 'current';

export type CprInfo = {
  bucket: CprBucket;
  daysUntil: number | null;
  label: string;
  pillClass: string;
};

export function cprBucketFromExpiry(
  expiresAt: string | null,
  now: Date = new Date(),
): CprInfo {
  if (!expiresAt) {
    return {
      bucket: 'missing',
      daysUntil: null,
      label: 'No CPR cert',
      pillClass: 'bg-creamSoft/5 text-creamSoft/60 border-creamSoft/15',
    };
  }
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return {
      bucket: 'missing',
      daysUntil: null,
      label: 'No CPR cert',
      pillClass: 'bg-creamSoft/5 text-creamSoft/60 border-creamSoft/15',
    };
  }
  const days = Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60_000));
  if (days < 0) {
    return {
      bucket: 'expired',
      daysUntil: days,
      label: `CPR expired ${Math.abs(days)}d ago`,
      pillClass: 'bg-rose-950/40 text-rose-200 border-rose-300/30',
    };
  }
  if (days <= 30) {
    return {
      bucket: 'expiring_soon',
      daysUntil: days,
      label: `CPR · ${days}d left`,
      pillClass: 'bg-amber-950/40 text-amber-200 border-amber-300/30',
    };
  }
  if (days <= 60) {
    return {
      bucket: 'expiring',
      daysUntil: days,
      label: `CPR · ${days}d left`,
      pillClass: 'bg-amber-950/20 text-amber-200/80 border-amber-300/15',
    };
  }
  return {
    bucket: 'current',
    daysUntil: days,
    label: `CPR · current`,
    pillClass: 'bg-emerald-950/30 text-emerald-200 border-emerald-300/25',
  };
}

export function formatCprDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Convert an ISO datetime or YYYY-MM-DD into the YYYY-MM-DD value an <input type="date"> wants.
export function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
