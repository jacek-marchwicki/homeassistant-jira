import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { BacklogView } from './components/BacklogView.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { Header } from './components/Header.tsx';
import { InstallHelpModal } from './components/InstallHelpModal.tsx';
import { KanbanBoard } from './components/KanbanBoard.tsx';
import { MobileInstallBanner } from './components/MobileInstallBanner.tsx';
import { useBoardStore } from './store/boardStore.ts';
import { getWsUrl } from './utils/paths.ts';
import { usePwaInstall } from './utils/usePwaInstall.ts';

export default function App() {
  const {
    loadBoard,
    handleWsMessage,
    setWsConnected,
    errorMessage,
    currentView,
    isLoading,
    boardName,
    issues,
  } = useBoardStore();
  const {
    canInstall,
    triggerInstall,
    showHelpModal,
    closeHelpModal,
    isAndroid,
    isIOS,
  } = usePwaInstall();
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Initial Load of Board State
  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // 2. Establish Resilient WebSocket Connection for Real-Time State Sync
  useEffect(() => {
    const wsUrl = getWsUrl();
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connectWs = () => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch {
          // ignore non-json messages (e.g. heartbeat pong)
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        // Exponential / periodic reconnect attempt
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connectWs();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [handleWsMessage, setWsConnected]);

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]"
        role="status"
        aria-live="polite"
        data-testid="loading-indicator"
      >
        <div className="flex flex-col items-center gap-4 text-center p-6">
          <div className="p-3 rounded-2xl bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] shadow-inner">
            <Loader2 className="w-10 h-10 animate-spin text-[var(--jira-primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--jira-text-primary)]">
              Loading board data...
            </h2>
            <p className="text-xs text-[var(--jira-text-secondary)] mt-1">
              Connecting to Jira and fetching active sprint issues...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage && !boardName && issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)] p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <div className="p-3 rounded-2xl bg-red-500/10 text-red-400">
            <AlertCircle className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--jira-text-primary)]">Failed to load board</h2>
            <p className="text-xs text-red-400 mt-1">{errorMessage}</p>
          </div>
          <button
            onClick={() => loadBoard()}
            className="mt-2 px-4 py-2 bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]">
      {/* Header with Board & Backlog Navigation + PWA Install */}
      <Header canInstall={canInstall} onInstall={triggerInstall} />

      {/* Touch-Friendly Mobile PWA Install Banner */}
      <MobileInstallBanner canInstall={canInstall} onInstall={triggerInstall} />

      {/* Error / Rollback Toast Banner */}
      {errorMessage && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 px-4 py-2 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Quick Filters & Search */}
      <FilterBar />

      {/* Main View: Kanban Board or Dedicated Backlog List View */}
      {currentView === 'board' ? <KanbanBoard /> : <BacklogView />}

      {/* PWA Installation Guidance Modal */}
      <InstallHelpModal
        isOpen={showHelpModal}
        onClose={closeHelpModal}
        isAndroid={isAndroid}
        isIOS={isIOS}
      />
    </div>
  );
}
