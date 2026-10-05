import { useState, useMemo } from 'react';
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
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
  splitIssuesByBacklog,
} from '../utils/boardUtils.ts';

export function KanbanBoard() {
  const {
    issues,
    columns,
    activeFilters,
    activeFilter,
    searchQuery,
    transitionIssueOptimistic,
    moveToBacklog,
  } = useBoardStore();
  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  // Configure drag sensors with distance/delay constraints to distinguish click/touch-scroll from drag
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter & Search Logic
  const filteredIssues = useMemo(
    () => filterIssues(issues, { activeFilters, activeFilter, searchQuery }),
    [issues, activeFilters, activeFilter, searchQuery]
  );

  // Active columns (excluding Backlog so it is never rendered as a Kanban column)
  const activeColumns = getActiveBoardColumns(columns);
  // Separate Backlog issues from Active Board issues
  const { boardIssues, backlogIssues } = splitIssuesByBacklog(filteredIssues, columns);

  // Collision detection: Prioritize pointer collisions to accurately target columns/cards under cursor
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

    const targetCol = getColumnFromOver(over, activeColumns, issues);
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

    const currentColumn = getColumnForIssue(activeItem, activeColumns);
    const targetCol = getColumnFromOver(over, activeColumns, issues);

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
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <main className="flex-1 p-4 flex flex-col overflow-y-auto">
        {/* Kanban Board Active Workflow Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:flex xl:flex-row gap-4 overflow-x-auto min-w-0">
          {activeColumns.map((col) => {
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
