import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Plus, Trash2, Check, X as XIcon, Clock } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';

type AuditEntry = {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  resource_type: 'punch' | 'user' | 'location' | 'missed_request';
  resource_id: number;
  action: string;
  before_state: any;
  after_state: any;
  reason: string | null;
  ts: string;
};

const RESOURCE_LABEL: Record<AuditEntry['resource_type'], string> = {
  punch: 'Punch',
  user: 'Staff',
  location: 'Office',
  missed_request: 'Missed-punch request',
};

const ACTION_ICON: Record<string, any> = {
  edit: Pencil,
  insert: Plus,
  create: Plus,
  delete: Trash2,
  approve: Check,
  deny: XIcon,
  auto_close: Clock,
};

const PAGE_SIZE = 50;

export default function Audit() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState<AuditEntry['resource_type'] | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  function buildPath(before?: string) {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('resource_type', filter);
    params.set('limit', String(PAGE_SIZE));
    if (before) params.set('before', before);
    return `/manage/audit?${params.toString()}`;
  }

  async function load() {
    const r = await api<{ entries: AuditEntry[] }>(buildPath(), {
      token: token ?? undefined,
    });
    setRows(r.entries);
    setExhausted(r.entries.length < PAGE_SIZE);
  }

  async function loadMore() {
    if (!rows || rows.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = rows[rows.length - 1];
      const r = await api<{ entries: AuditEntry[] }>(buildPath(last.ts), {
        token: token ?? undefined,
      });
      setRows([...rows, ...r.entries]);
      setExhausted(r.entries.length < PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setExhausted(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, token]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            Audit <span className="font-serif italic text-cream">log</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            Every edit, with before-and-after.
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="bg-graphite border border-creamSoft/15 rounded-full px-4 py-2 text-sm text-creamSoft focus:outline-none focus:border-cream/40"
        >
          <option value="all">All resources</option>
          <option value="punch">Punches</option>
          <option value="user">Staff</option>
          <option value="location">Offices</option>
          <option value="missed_request">Missed-punch requests</option>
        </select>
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 bg-graphite/40 divide-y divide-creamSoft/5 overflow-hidden">
        {!rows ? (
          <ListSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">No entries.</div>
        ) : (
          rows.map((e, i) => {
            const Icon = ACTION_ICON[e.action] ?? Pencil;
            const isOpen = expanded.has(e.id);
            const showDiff =
              e.before_state || e.after_state ? true : false;

            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.2) }}
                className={[
                  showDiff ? 'cursor-pointer hover:bg-creamSoft/5' : '',
                  'transition-colors p-5',
                ].join(' ')}
                onClick={() => showDiff && toggle(e.id)}
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream text-ink">
                    <Icon size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-creamSoft text-sm tracking-tight">
                        {e.actor_name ?? 'System'}
                      </span>
                      <span className="text-creamSoft/40 text-sm">
                        {actionPhrase(e)}
                      </span>
                      <span className="text-creamSoft/40 text-xs uppercase tracking-[0.18em]">
                        {RESOURCE_LABEL[e.resource_type]} #{e.resource_id}
                      </span>
                    </div>
                    {e.reason && (
                      <div className="text-creamSoft/60 text-sm mt-1 italic">
                        "{e.reason}"
                      </div>
                    )}
                  </div>
                  <div className="text-creamSoft/40 text-xs tabular-nums whitespace-nowrap shrink-0">
                    {formatWhen(e.ts)}
                  </div>
                </div>

                {isOpen && showDiff && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.25 }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pl-14"
                  >
                    <DiffPane label="Before" data={e.before_state} />
                    <DiffPane label="After" data={e.after_state} />
                  </motion.div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {rows && rows.length > 0 && !exhausted && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/70 px-5 py-2 text-sm tracking-tight disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function DiffPane({ label, data }: { label: string; data: any }) {
  return (
    <div className="rounded-2xl border border-creamSoft/10 bg-ink p-3">
      <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase mb-2">
        {label}
      </div>
      {data ? (
        <pre className="text-creamSoft/70 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">
          {JSON.stringify(redact(data), null, 2)}
        </pre>
      ) : (
        <div className="text-creamSoft/30 text-xs italic">—</div>
      )}
    </div>
  );
}

function actionPhrase(e: AuditEntry): string {
  switch (e.action) {
    case 'edit':
      return 'edited';
    case 'insert':
    case 'create':
      return 'created';
    case 'delete':
      return 'deleted';
    case 'approve':
      return 'approved';
    case 'deny':
      return 'denied';
    case 'auto_close':
      return 'auto-closed';
    default:
      return e.action;
  }
}

function redact(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  const skip = new Set(['pin_hash', 'password_hash']);
  if (Array.isArray(obj)) return obj.map(redact);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    out[k] = redact(v);
  }
  return out;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
}
