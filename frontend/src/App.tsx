import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { FilterBar } from './components/FilterBar.tsx';
import { Header } from './components/Header.tsx';
import { KanbanBoard } from './components/KanbanBoard.tsx';
import { useBoardStore } from './store/boardStore.ts';
import { getWsUrl } from './utils/paths.ts';

export default function App() {
  const { loadBoard, handleWsMessage, setWsConnected, errorMessage } = useBoardStore();
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

  return (
    <div className="flex flex-col min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]">
      {/* Header */}
      <Header />

      {/* Error / Rollback Toast Banner */}
      {errorMessage && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 px-4 py-2 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Quick Filters & Search */}
      <FilterBar />

      {/* Kanban Board with Drag-and-Drop */}
      <KanbanBoard />
    </div>
  );
}
