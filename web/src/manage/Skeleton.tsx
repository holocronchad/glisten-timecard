// Shimmer skeleton for dashboard loading states. Matches the cream/ink
// palette with a subtle gradient sweep.

type RowsProps = {
  rows?: number;
  className?: string;
};

export function ListSkeleton({ rows = 5, className = '' }: RowsProps) {
  return (
    <div className={['divide-y divide-creamSoft/5', className].join(' ')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-5">
          <Bar className="h-3 w-32" />
          <Bar className="h-3 flex-1" delay={i * 0.05} />
          <Bar className="h-3 w-16" delay={i * 0.07} />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({
  count = 3,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={['grid gap-4', className].join(' ')}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-3xl border border-creamSoft/10 bg-graphite/40 p-5"
        >
          <Bar className="h-10 w-10 rounded-full" />
          <Bar className="h-3 w-32 mt-4" delay={i * 0.05} />
          <Bar className="h-2 w-44 mt-2" delay={i * 0.08} />
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Bar className="h-3" delay={0.15} />
            <Bar className="h-3" delay={0.18} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Bar({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={['shimmer rounded-md', className].join(' ')}
      style={{ animationDelay: `${delay}s` }}
    />
  );
}
