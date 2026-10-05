import { Smartphone, Apple, Monitor, X, ExternalLink } from 'lucide-react';

interface InstallHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAndroid: boolean;
  isIOS: boolean;
}

export function InstallHelpModal({
  isOpen,
  onClose,
  isAndroid,
  isIOS,
}: InstallHelpModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl p-5 text-[var(--jira-text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--jira-border)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)]">
              <Smartphone className="w-5 h-5" />
            </div>
            <h2 id="install-modal-title" className="text-base font-bold">
              Install Jira Dashboard
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-canvas)] min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content based on device */}
        <div className="py-4 space-y-4 text-sm text-[var(--jira-text-secondary)]">
          {isAndroid ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--jira-primary)] font-semibold text-xs uppercase tracking-wider">
                <Smartphone className="w-4 h-4" />
                <span>Android (Chrome / Samsung Internet)</span>
              </div>
              <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-[var(--jira-text-primary)]">
                <li>
                  Tap the browser menu <strong className="text-[var(--jira-primary)]">⋮</strong> (three vertical dots in the top-right corner).
                </li>
                <li>
                  Select <strong className="text-[var(--jira-primary)]">Install app</strong> or <strong className="text-[var(--jira-primary)]">Add to Home screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-[var(--jira-primary)]">Install</strong> to add Jira Dashboard to your app drawer and home screen.
                </li>
              </ol>
            </div>
          ) : isIOS ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--jira-primary)] font-semibold text-xs uppercase tracking-wider">
                <Apple className="w-4 h-4" />
                <span>Apple iOS (Safari)</span>
              </div>
              <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-[var(--jira-text-primary)]">
                <li>
                  Tap the <strong className="text-[var(--jira-primary)]">Share</strong> button at the bottom of Safari.
                </li>
                <li>
                  Scroll down and tap <strong className="text-[var(--jira-primary)]">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-[var(--jira-primary)]">Add</strong> in the top-right corner.
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--jira-primary)] font-semibold text-xs uppercase tracking-wider">
                <Monitor className="w-4 h-4" />
                <span>Desktop Browser (Chrome / Edge / Brave)</span>
              </div>
              <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-[var(--jira-text-primary)]">
                <li>
                  Click the <strong className="text-[var(--jira-primary)]">Install</strong> icon in the browser address bar.
                </li>
                <li>
                  Or open the browser menu and select <strong className="text-[var(--jira-primary)]">Install Jira Dashboard</strong>.
                </li>
              </ol>
            </div>
          )}

          <div className="pt-2 text-2xs text-[var(--jira-text-muted)] flex items-center gap-1.5 border-t border-[var(--jira-border)]">
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span>
              Once installed, the app runs in full-screen standalone mode with offline app shell support.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white text-xs font-semibold cursor-pointer min-h-[40px]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
