import { useState, useMemo } from 'react';
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';
import { BacklogIssueRow } from './BacklogIssueRow.tsx';
import { BacklogPanel } from './BacklogPanel.tsx';
import { IssueCard } from './IssueCard.tsx';
import { KanbanColumn } from './KanbanColumn.tsx';
import {
  filterIssues,
  filterIssuesForColumn,
  getActiveBoardColumns,
  getCategoryColorVar,
  getColumnForIssue,
  getColumnFromOver,
  isBacklogIssue,
  isInProgressColumn,
  isIntermediateColumn,
  splitIssuesByBacklog,
} from '../utils/boardUtils.ts';

export function KanbanBoard() {
  const {
    issues,
    columns,
    activeFilters,
    activeFilter,
    searchQuery,
    currentUser,
    transitionIssueOptimistic,
    moveToBacklog,
  } = useBoardStore();
  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  // Configure drag sensors:
  // - MouseSensor: Instant drag on mouse click + drag (distance: 5px) without long-press delay
  // - TouchSensor: Long-press required on touch (delay: 250ms, tolerance: 8px) to prevent scroll interference
  // - KeyboardSensor: Accessible keyboard navigation
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter & Search Logic
  const filteredIssues = useMemo(
    () => filterIssues(issues, { activeFilters, activeFilter, searchQuery, currentUser }),
    [issues, activeFilters, activeFilter, searchQuery, currentUser]
  );

  // Active columns (excluding Backlog so it is never rendered as a Kanban column)
  const activeColumns = getActiveBoardColumns(columns);

  // Intermediate workflow columns (In Progress, In Review, etc.) should never appear on the board as separate columns.
  // Their tasks are merged into Ready, and an In Progress drop target appears at the top of the Ready list during drag.
  const displayedColumns = useMemo(() => {
    return activeColumns.filter((col) => !isIntermediateColumn(col));
  }, [activeColumns]);

  // Separate Backlog issues from Active Board issues
  const { boardIssues, backlogIssues } = splitIssuesByBacklog(filteredIssues, columns);

  // Collision detection: Prioritize pointer collisions to accurately target columns/cards under cursor
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const { pointerCoordinates } = args;
    if (pointerCoordinates && typeof document !== 'undefined') {
      const dropTargetEl = document.querySelector('[data-testid="ready-drop-target-inprogress"]');
      if (dropTargetEl) {
        const rect = dropTargetEl.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          pointerCoordinates.x >= rect.left &&
          pointerCoordinates.x <= rect.right &&
          pointerCoordinates.y >= rect.top &&
          pointerCoordinates.y <= rect.bottom
        ) {
          const container = args.droppableContainers.find(
            (c) => c.id === 'ready-drop-target-inprogress'
          );
          if (container) {
            return [{ id: 'ready-drop-target-inprogress', data: { droppableContainer: container, value: 0 } }];
          }
          return [{ id: 'ready-drop-target-inprogress' }];
        }
      }
    }

    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      const inProgressTarget = pointerCollisions.find(
        (c) => c.id === 'ready-drop-target-inprogress'
      );
      if (inProgressTarget) {
        return [inProgressTarget, ...pointerCollisions.filter((c) => c.id !== inProgressTarget.id)];
      }
      return pointerCollisions;
    }
    return closestCorners(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const issue = issues.find((i) => i.key === active.id);
    if (issue) {
      setActiveIssue(issue);
      const initialCol = getColumnForIssue(issue, activeColumns);
      setOverColumnId(initialCol?.id ?? null);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverColumnId(null);
      return;
    }

    const overData = over.data?.current;
    if (over.id === 'panel-backlog-list' || overData?.targetType === 'backlog') {
      setOverColumnId('backlog');
      return;
    }

    // If over an issue in the backlog list
    if (backlogIssues.some((i) => i.key === String(over.id))) {
      setOverColumnId('backlog');
      return;
    }

    if (
      over.id === 'ready-drop-target-inprogress' ||
      overData?.type === 'InProgressDropTarget' ||
      overData?.targetType === 'inprogress'
    ) {
      setOverColumnId('inprogress');
      return;
    }

    const targetCol = getColumnFromOver(over, displayedColumns, issues);
    setOverColumnId(targetCol?.id ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveIssue(null);
    setOverColumnId(null);

    if (!over) return;

    const activeKey = String(active.id);
    const activeItem = issues.find((i) => i.key === activeKey);
    if (!activeItem) return;

    const overData = over.data?.current;
    if (
      over.id === 'panel-backlog-list' ||
      overData?.targetType === 'backlog' ||
      backlogIssues.some((i) => i.key === String(over.id))
    ) {
      moveToBacklog(activeKey);
      return;
    }

    if (
      over.id === 'ready-drop-target-inprogress' ||
      overData?.type === 'InProgressDropTarget' ||
      overData?.targetType === 'inprogress'
    ) {
      const inProgressCol = columns.find((c) => isInProgressColumn(c));
      const category = inProgressCol?.category ?? 'inprogress';
      const statusName = inProgressCol?.name ?? 'In Progress';
      if (activeItem.status?.category !== category) {
        transitionIssueOptimistic(activeKey, category, statusName);
      }
      return;
    }

    const currentColumn = getColumnForIssue(activeItem, activeColumns);
    const targetCol = getColumnFromOver(over, displayedColumns, issues);

    if (
      targetCol &&
      (currentColumn?.id !== targetCol.id || isBacklogIssue(activeItem, columns))
    ) {
      transitionIssueOptimistic(activeKey, targetCol.category, targetCol.name);
    }
  };

  const handleDragCancel = () => {
    setActiveIssue(null);
    setOverColumnId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      measuring={{
        droppable: {
          strategy: MeasuringStrategy.Always,
        },
      }}
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
      <main className="flex-1 p-4 flex flex-col overflow-y-auto">
        {/* Kanban Board Active Workflow Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:flex xl:flex-row gap-4 overflow-x-auto min-w-0">
          {displayedColumns.map((col) => {
            const colIssues = filterIssuesForColumn(boardIssues, col, activeColumns);
            const colorVar = getCategoryColorVar(col.category);
            return (
              <KanbanColumn
                key={col.id}
                id={col.id}
                category={col.category}
                title={col.name}
                colorVar={colorVar}
                issues={colIssues}
                isHighlighted={overColumnId === col.id}
                isDragging={activeIssue !== null}
              />
            );
          })}
        </div>

        {/* Backlog Displayed Separately as a List of Issues */}
        <BacklogPanel
          issues={backlogIssues}
          isHighlighted={overColumnId === 'backlog'}
        />
      </main>

      <DragOverlay>
        {activeIssue ? (
          isBacklogIssue(activeIssue, columns) ? (
            <BacklogIssueRow issue={activeIssue} isDragOverlay />
          ) : (
            <IssueCard issue={activeIssue} isDragOverlay />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
