import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, RotateCcw, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import type { OfflineOutboxItem } from '../store/boardStore.ts';
import type { JiraUser } from '../types/jira.ts';

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

function renderTransactionDetails(item: OfflineOutboxItem, users: JiraUser[]) {
  const p = item.payload || {};
  const details: string[] = [];

  if (item.action === 'transition_issue') {
    const target = p.target_status || p.target_category;
    if (target) {
      details.push(`Status: ${target}`);
    }
  } else if (item.action === 'update_issue') {
    if (p.summary) details.push(`Summary: "${p.summary}"`);
    if (p.status_name || p.status_category) {
      details.push(`Status: ${p.status_name || p.status_category}`);
    }
    if (p.priority) details.push(`Priority: ${p.priority}`);
    if (p.issue_type) details.push(`Type: ${p.issue_type}`);
    if (p.assignee_id !== undefined) {
      const user = users.find((u) => u.accountId === p.assignee_id);
      details.push(`Assignee: ${user ? user.displayName : p.assignee_id || 'Unassigned'}`);
    }
    if (p.description !== undefined) details.push('Description updated');
    if (p.start_date !== undefined) details.push(`Start date: ${p.start_date || 'None'}`);
    if (p.due_date !== undefined) details.push(`Due date: ${p.due_date || 'None'}`);
  } else if (item.action === 'create_issue') {
    if (p.summary) details.push(`Summary: "${p.summary}"`);
    if (p.issue_type) details.push(`Type: ${p.issue_type}`);
    if (p.priority) details.push(`Priority: ${p.priority}`);
    if (p.assignee_id) {
      const user = users.find((u) => u.accountId === p.assignee_id);
      details.push(`Assignee: ${user ? user.displayName : p.assignee_id}`);
    }
  } else if (item.action === 'rank_issue') {
    if (p.rank_before_key && p.rank_after_key) {
      details.push(`Reorder between ${p.rank_after_key} and ${p.rank_before_key}`);
    } else if (p.rank_before_key) {
      details.push(`Move before ${p.rank_before_key}`);
    } else if (p.rank_after_key) {
      details.push(`Move after ${p.rank_after_key}`);
    } else {
      details.push('Reorder position');
    }
  }

  if (details.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-[var(--jira-text-secondary)]">
      {details.map((d, i) => (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--jira-surface)] border border-[var(--jira-border)]"
        >
          {d}
        </span>
      ))}
    </div>
  );
}

export function ConnectionStatusModal({ isOpen, onClose }: ConnectionStatusModalProps) {
  const wsConnected = useBoardStore((s) => s.wsConnected);
  const syncStatus = useBoardStore((s) => s.syncStatus);
  const syncError = useBoardStore((s) => s.syncError);
  const outbox = useBoardStore((s) => s.offlineOutbox);
  const details = useBoardStore((s) => s.connectionDetails);
  const availableUsers = useBoardStore((s) => s.availableUsers);
  const removePendingTransaction = useBoardStore((s) => s.removePendingTransaction);
  const clearLocalDataAndRefetch = useBoardStore((s) => s.clearLocalDataAndRefetch);

  const [now, setNow] = useState(() => Date.now());
  const [isClearing, setIsClearing] = useState(false);

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

  const handleClearLocalData = async () => {
    setIsClearing(true);
    try {
      await clearLocalDataAndRefetch();
    } finally {
      setIsClearing(false);
    }
  };

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
            <ul className="mt-2 space-y-2">
              {outbox.map((item) => (
                <li
                  key={item.id}
                  className="p-2.5 rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)]"
                >
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{ACTION_LABELS[item.action]}</span>
                        <span className="text-[var(--jira-text-secondary)]">
                          {item.issueKey ?? 'new issue'} · {formatTime(item.createdAt)}
                        </span>
                      </div>
                      {renderTransactionDetails(item, availableUsers)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePendingTransaction(item.id)}
                      aria-label={`Remove transaction ${item.id}`}
                      title="Remove transaction"
                      className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md text-[var(--jira-text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 pt-4 border-t border-[var(--jira-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--jira-text-secondary)]">
            Reset & Re-sync
          </h3>
          <p className="text-xs mt-1 text-[var(--jira-text-secondary)]">
            Clear local cached data and unsent offline transactions, then reload fresh state directly from Jira.
          </p>
          <button
            type="button"
            data-testid="clear-local-data-button"
            onClick={handleClearLocalData}
            disabled={isClearing}
            className="w-full mt-3 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
          >
            {isClearing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            <span>{isClearing ? 'Clearing and fetching…' : 'Clear local data & re-fetch'}</span>
          </button>
        </section>
      </div>
    </div>
  );
}
