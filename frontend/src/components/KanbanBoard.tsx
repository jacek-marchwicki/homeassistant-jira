import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useBoardStore } from '../store/boardStore.ts';
import { BoardColumn, JiraIssue } from '../types/jira.ts';
import { IssueCard } from './IssueCard.tsx';
import { KanbanColumn } from './KanbanColumn.tsx';
import { getCategoryColorVar, getColumnForIssue } from '../utils/boardUtils.ts';

export function KanbanBoard() {
  const { issues, columns, activeFilter, searchQuery, transitionIssueOptimistic } = useBoardStore();
  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);

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

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const issue = issues.find((i) => i.key === active.id);
    if (issue) {
      setActiveIssue(issue);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveIssue(null);

    if (!over) return;

    const activeKey = String(active.id);
    const activeItem = issues.find((i) => i.key === activeKey);
    if (!activeItem) return;

    const currentColumn = getColumnForIssue(activeItem, columns);

    // Detect target column from dropped column or dropped issue
    let targetCol: BoardColumn | undefined = undefined;
    const overData = over.data.current;

    if (overData?.type === 'Column' && overData.columnId) {
      targetCol = columns.find((c) => c.id === overData.columnId);
    } else if (overData?.type === 'Issue' && overData.issue) {
      targetCol = getColumnForIssue(overData.issue, columns);
    } else {
      // Fallback: match by column ID
      targetCol = columns.find((c) => c.id === over.id);
    }

    if (targetCol && currentColumn?.id !== targetCol.id) {
      transitionIssueOptimistic(activeKey, targetCol.category, targetCol.name);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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
