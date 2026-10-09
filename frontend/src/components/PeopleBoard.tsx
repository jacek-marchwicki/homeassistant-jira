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
import { PeopleColumn } from './PeopleColumn.tsx';
import {
  filterIssuesForPeopleColumn,
  getAssigneesFromBoard,
  handlePeopleDragEnd,
  isBacklogIssue,
  splitIssuesByBacklog,
} from '../utils/boardUtils.ts';

interface PeopleBoardProps {
  now?: Date;
}

export function PeopleBoard({ now = new Date() }: PeopleBoardProps) {
  const {
    issues,
    columns,
    availableUsers,
    currentUser,
    activeFilters,
    activeFilter,
    searchQuery,
    updateIssueOptimistic,
    rankIssueOptimistic,
    moveToBacklog,
    moveToBoard,
  } = useBoardStore();

  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [overTargetId, setOverTargetId] = useState<string | null>(null);

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

  // Separate Backlog issues from Active Board issues
  const { boardIssues, backlogIssues } = useMemo(
    () => splitIssuesByBacklog(issues, columns, 1, now),
    [issues, columns, now]
  );

  // Extract all team members / assignees
  const people = useMemo(
    () => getAssigneesFromBoard(boardIssues, availableUsers, currentUser),
    [boardIssues, availableUsers, currentUser]
  );

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
      setOverTargetId(null);
      return;
    }

    const overData = over.data?.current;
    if (over.id === 'panel-backlog-list' || overData?.targetType === 'backlog') {
      setOverTargetId('backlog');
      return;
    }

    if (backlogIssues.some((i) => i.key === String(over.id))) {
      setOverTargetId('backlog');
      return;
    }

    setOverTargetId(String(over.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssue(null);
    setOverTargetId(null);

    handlePeopleDragEnd(event, {
      issues,
      backlogIssues,
      people,
      updateIssueOptimistic,
      rankIssueOptimistic,
      moveToBacklog,
      moveToBoard,
    });
  };

  const handleDragCancel = () => {
    setActiveIssue(null);
    setOverTargetId(null);
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
        {/* People Board Columns by Assignee */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:flex xl:flex-row gap-4 overflow-x-auto min-w-0">
          {people.map((person) => {
            const personIssues = filterIssuesForPeopleColumn(boardIssues, person, {
              activeFilters,
              activeFilter,
              searchQuery,
              now,
            });
            const colId = person.accountId || person.displayName;

            return (
              <PeopleColumn
                key={colId}
                person={person}
                issues={personIssues}
                now={now}
                isHighlighted={overTargetId === `people-column-${colId}`}
              />
            );
          })}
        </div>

        {/* Backlog Displayed Separately at Bottom */}
        <BacklogPanel
          issues={backlogIssues}
          isHighlighted={overTargetId === 'backlog'}
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
