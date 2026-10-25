import { useEffect, useState } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';

export function UndoSnackbar() {
  const { pendingQuickDone, undoQuickDone } = useBoardStore();
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!pendingQuickDone) {
      setProgress(100);
      return;
    }

    const { startTime, durationMs } = pendingQuickDone;
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remainingPct);
    }, 50);

    return () => clearInterval(interval);
  }, [pendingQuickDone]);

  if (!pendingQuickDone) {
    return null;
  }

  const { issueKey, targetStatus } = pendingQuickDone;
  const statusLabel = targetStatus || 'Done';

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="undo-snackbar"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-3.5 px-4 py-2.5 rounded-xl bg-[var(--jira-surface-elevated)] text-[var(--jira-text-primary)] border border-[var(--jira-border)] shadow-2xl max-w-[92vw] sm:max-w-md w-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-xs font-medium text-[var(--jira-text-primary)] truncate">
          Marked <strong className="font-bold text-[var(--jira-text-primary)]">{issueKey}</strong> as {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={undoQuickDone}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] rounded-lg min-h-[44px] cursor-pointer touch-manipulation active:scale-95 transition-all shadow-xs"
          aria-label={`Undo marking ${issueKey} as ${statusLabel}`}
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Undo</span>
        </button>
      </div>

      {/* Progress countdown bar */}
      <div
        className="absolute bottom-0 left-0 h-[3px] bg-[var(--jira-primary)]/70 transition-[width] duration-75 ease-linear pointer-events-none"
        style={{ width: `${progress}%` }}
        aria-hidden="true"
      />
    </aside>
  );
}
