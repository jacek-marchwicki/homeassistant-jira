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
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { IssueCard } from './IssueCard.tsx';
import { KanbanColumn } from './KanbanColumn.tsx';

interface ColumnDef {
  id: string;
  category: JiraStatusCategory;
  title: string;
  colorVar: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'col-todo', category: 'todo', title: 'To Do', colorVar: 'var(--jira-status-todo)' },
  {
    id: 'col-inprogress',
    category: 'inprogress',
    title: 'In Progress',
    colorVar: 'var(--jira-status-inprogress)',
  },
  {
    id: 'col-inreview',
    category: 'inreview',
    title: 'In Review',
    colorVar: 'var(--jira-status-inreview)',
  },
  { id: 'col-done', category: 'done', title: 'Done', colorVar: 'var(--jira-status-done)' },
];

export function KanbanBoard() {
  const { issues, activeFilter, searchQuery, transitionIssueOptimistic } = useBoardStore();
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

    // Detect target category from dropped column or dropped issue
    let targetCategory: JiraStatusCategory | null = null;
    const overData = over.data.current;

    if (overData?.type === 'Column' && overData.category) {
      targetCategory = overData.category as JiraStatusCategory;
    } else if (overData?.type === 'Issue' && overData.issue) {
      targetCategory = overData.issue.status.category as JiraStatusCategory;
    } else {
      // Fallback: match by column ID
      const targetCol = COLUMNS.find((c) => c.id === over.id);
      if (targetCol) {
        targetCategory = targetCol.category;
      }
    }

    if (targetCategory && activeItem.status.category !== targetCategory) {
      transitionIssueOptimistic(activeKey, targetCategory);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-y-auto">
        {COLUMNS.map((col) => {
          const colIssues = filteredIssues.filter((i) => i.status.category === col.category);
          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              category={col.category}
              title={col.title}
              colorVar={col.colorVar}
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
