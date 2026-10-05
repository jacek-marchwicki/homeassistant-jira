import { useState } from 'react';
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
import { IssueCard } from './IssueCard.tsx';
import { KanbanColumn } from './KanbanColumn.tsx';
import {
  getCategoryColorVar,
  getColumnForIssue,
  getColumnFromOver,
} from '../utils/boardUtils.ts';

export function KanbanBoard() {
  const { issues, columns, activeFilter, searchQuery, transitionIssueOptimistic } = useBoardStore();
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
  const filteredIssues = issues.filter((issue) => {
    // 1. Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesKey = issue.key.toLowerCase().includes(q);
      const matchesSummary = issue.summary.toLowerCase().includes(q);
      if (!matchesKey && !matchesSummary) return false;
    }

    // 2. Quick Category Filter
    if (activeFilter === 'my') {
      const name = issue.assignee?.displayName || issue.assignee?.display_name || '';
      return name.includes('Jacek');
    }
    if (activeFilter === 'blockers') {
      return issue.priority === 'highest' || issue.status.category === 'blocked';
    }
    return true;
  });

  // Collision detection: Prioritize pointer collisions to accurately target columns/cards under the cursor,
  // falling back to closestCorners for edge cases and keyboard dragging.
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
      const initialCol = getColumnForIssue(issue, columns);
      setOverColumnId(initialCol?.id ?? null);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverColumnId(null);
      return;
    }
    const targetCol = getColumnFromOver(over, columns, issues);
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

    const currentColumn = getColumnForIssue(activeItem, columns);
    const targetCol = getColumnFromOver(over, columns, issues);

    if (targetCol && currentColumn?.id !== targetCol.id) {
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
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 xl:flex xl:flex-row gap-4 overflow-y-auto overflow-x-auto min-w-0">
        {columns.map((col) => {
          const colIssues = filteredIssues.filter(
            (i) => getColumnForIssue(i, columns)?.id === col.id
          );
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
      </main>

      <DragOverlay>
        {activeIssue ? <IssueCard issue={activeIssue} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
