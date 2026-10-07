import { useState, useMemo } from 'react';
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, Layers, ListTodo } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';
import { BacklogIssueRow } from './BacklogIssueRow.tsx';
import { BacklogList } from './BacklogList.tsx';
import { filterIssues, handleBacklogDragEnd, splitIssuesByBacklog } from '../utils/boardUtils.ts';

export function BacklogView() {
  const {
    issues,
    columns,
    sprintName,
    activeFilters,
    activeFilter,
    searchQuery,
    currentUser,
    moveToBoard,
    moveToBacklog,
    rankIssueOptimistic,
  } = useBoardStore();

  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [overTarget, setOverTarget] = useState<'board' | 'backlog' | null>(null);
  const [isSprintCollapsed, setIsSprintCollapsed] = useState(false);
  const [isBacklogCollapsed, setIsBacklogCollapsed] = useState(false);

  // Configure drag sensors:
  // - MouseSensor: Instant drag on mouse click + drag (distance: 5px) without long-press delay
  // - TouchSensor: Long-press required on touch (delay: 250ms, tolerance: 8px) to prevent scroll interference
  // - KeyboardSensor: Accessible keyboard navigation
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter issues based on active filter and search query
  const filteredIssues = useMemo(
    () => filterIssues(issues, { activeFilters, activeFilter, searchQuery, currentUser }),
    [issues, activeFilters, activeFilter, searchQuery, currentUser]
  );

  const { boardIssues, backlogIssues } = splitIssuesByBacklog(filteredIssues, columns);

  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCorners(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const issue = issues.find((i) => i.key === active.id);
    if (issue) {
      setActiveIssue(issue);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverTarget(null);
      return;
    }
    const overData = over.data?.current;
    if (overData?.targetType) {
      setOverTarget(overData.targetType as 'board' | 'backlog');
    } else if (over.id === 'backlog-view-sprint-list') {
      setOverTarget('board');
    } else if (over.id === 'backlog-view-backlog-list') {
      setOverTarget('backlog');
    } else {
      // Check if over target is an issue inside board or backlog
      const overIssueKey = String(over.id);
      const isBoard = boardIssues.some((i) => i.key === overIssueKey);
      setOverTarget(isBoard ? 'board' : 'backlog');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssue(null);
    setOverTarget(null);

    handleBacklogDragEnd(event, {
      issues,
      boardIssues,
      backlogIssues,
      moveToBoard,
      moveToBacklog,
      rankIssueOptimistic,
    });
  };

  const handleDragCancel = () => {
    setActiveIssue(null);
    setOverTarget(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      autoScroll={{
        threshold: { x: 0.1, y: 0.15 },
        acceleration: 10,
        canScroll: (element) =>
          element.scrollHeight > element.clientHeight ||
          element.scrollWidth > element.clientWidth,
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <main
        data-testid="backlog-view"
        className="flex-1 p-4 max-w-7xl mx-auto w-full flex flex-col gap-6 overflow-y-auto"
      >
        {/* Section 1: Active Sprint / Board Issues */}
        <section className="rounded-xl border border-[var(--jira-border)] bg-[var(--jira-surface)] shadow-xs overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--jira-surface-elevated)]/60 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setIsSprintCollapsed(!isSprintCollapsed)}
                className="p-1 rounded text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer"
                aria-expanded={!isSprintCollapsed}
                aria-label={isSprintCollapsed ? 'Expand Sprint' : 'Collapse Sprint'}
              >
                {isSprintCollapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>

              <div className="p-1.5 rounded-lg bg-[var(--jira-primary)]/15 text-[var(--jira-primary)]">
                <Layers className="w-4 h-4" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[var(--jira-text-primary)]">
                    {sprintName || 'Active Sprint'}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                    Active
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]">
                    {boardIssues.length} {boardIssues.length === 1 ? 'issue' : 'issues'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {!isSprintCollapsed && (
            <div className="p-3">
              <BacklogList
                id="backlog-view-sprint-list"
                type="board"
                issues={boardIssues}
                emptyMessage="No issues in the active sprint. Drag issues from the Backlog to start sprint work."
                isHighlighted={overTarget === 'board'}
              />
            </div>
          )}
        </section>

        {/* Section 2: Backlog Issues */}
        <section className="rounded-xl border border-[var(--jira-border)] bg-[var(--jira-surface)] shadow-xs overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--jira-surface-elevated)]/60 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setIsBacklogCollapsed(!isBacklogCollapsed)}
                className="p-1 rounded text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer"
                aria-expanded={!isBacklogCollapsed}
                aria-label={isBacklogCollapsed ? 'Expand Backlog' : 'Collapse Backlog'}
              >
                {isBacklogCollapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>

              <div className="p-1.5 rounded-lg bg-[var(--jira-primary)]/15 text-[var(--jira-primary)]">
                <ListTodo className="w-4 h-4" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[var(--jira-text-primary)]">Backlog</h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]">
                    {backlogIssues.length} {backlogIssues.length === 1 ? 'issue' : 'issues'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {!isBacklogCollapsed && (
            <div className="p-3">
              <BacklogList
                id="backlog-view-backlog-list"
                type="backlog"
                issues={backlogIssues}
                emptyMessage="Your backlog is empty. Drag issues here or move tickets back from the sprint."
                isHighlighted={overTarget === 'backlog'}
              />
            </div>
          )}
        </section>
      </main>

      <DragOverlay>
        {activeIssue ? <BacklogIssueRow issue={activeIssue} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
