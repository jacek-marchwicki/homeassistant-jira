import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import type { OfflineOutboxItem } from '../store/boardStore.ts';

interface ConnectionStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<OfflineOutboxItem['action'], string> = {
  create_issue: 'Create issue',
  update_issue: 'Update issue',
  transition_issue: 'Transition issue',
  rank_issue: 'Reorder issue',
};

function formatTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleTimeString() : '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs py-1.5">
      <dt className="text-[var(--jira-text-secondary)]">{label}</dt>
      <dd className="text-right font-medium break-words min-w-0">{value}</dd>
    </div>
  );
}

export function ConnectionStatusModal({ isOpen, onClose }: ConnectionStatusModalProps) {
  const wsConnected = useBoardStore((s) => s.wsConnected);
  const syncStatus = useBoardStore((s) => s.syncStatus);
  const syncError = useBoardStore((s) => s.syncError);
  const outbox = useBoardStore((s) => s.offlineOutbox);
  const details = useBoardStore((s) => s.connectionDetails);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const retrySeconds =
    !wsConnected && details.nextRetryAt
      ? Math.max(0, Math.ceil((details.nextRetryAt - now) / 1000))
      : null;
  const StatusIcon = wsConnected ? Wifi : WifiOff;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-md bg-[var(--jira-surface)] border-0 sm:border border-[var(--jira-border)] rounded-none sm:rounded-xl shadow-none sm:shadow-2xl p-4 sm:p-6 pb-8 sm:pb-6 relative overflow-y-auto overscroll-contain text-[var(--jira-text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[var(--jira-border)]">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg ${
                wsConnected
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}
            >
              <StatusIcon className="w-5 h-5" />
            </div>
            <h2 id="connection-modal-title" className="text-base sm:text-lg font-bold">
              {wsConnected ? 'Connected' : 'Reconnecting'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--jira-text-secondary)]">
            Live connection
          </h3>
          <p className="text-xs mt-1.5 text-[var(--jira-text-secondary)]">
            {wsConnected
              ? 'Real-time updates from Jira are streaming normally.'
              : 'Real-time updates are paused. Your changes are kept locally and will sync once the connection is restored.'}
          </p>
          <dl className="mt-2 divide-y divide-[var(--jira-border)]">
            {!wsConnected && (
              <Row
                label="Next attempt"
                value={
                  retrySeconds === null
                    ? 'Connecting…'
                    : retrySeconds === 0
                      ? 'Retrying now…'
                      : `Retrying in ${retrySeconds}s`
                }
              />
            )}
            {!wsConnected && details.retryAttempt > 0 && (
              <Row label="Failed attempts" value={String(details.retryAttempt)} />
            )}
            {!wsConnected && (
              <Row label="Cause" value={details.lastError ?? 'Unknown'} />
            )}
            <Row label="Last connected" value={formatTime(details.lastConnectedAt)} />
            <Row label="Last disconnected" value={formatTime(details.lastDisconnectedAt)} />
          </dl>
        </section>

        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--jira-text-secondary)] flex items-center gap-1.5">
            {syncStatus === 'syncing' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : syncStatus === 'offline' ? (
              <CloudOff className="w-3.5 h-3.5 text-amber-500" />
            ) : null}
            Pending to send ({outbox.length})
          </h3>
          {syncError && (
            <p className="text-xs mt-1.5 text-amber-500">Last sync error: {syncError}</p>
          )}
          {outbox.length === 0 ? (
            <p className="text-xs mt-1.5 text-[var(--jira-text-secondary)]">
              Nothing pending — all changes are synced.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {outbox.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)]"
                >
                  <span className="font-semibold">{ACTION_LABELS[item.action]}</span>
                  <span className="text-[var(--jira-text-secondary)] truncate">
                    {item.issueKey ?? 'new issue'} · {formatTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
