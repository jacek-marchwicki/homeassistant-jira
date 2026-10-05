import { Bookmark, CheckSquare, CircleDot, CornerDownRight } from 'lucide-react';

interface IssueTypeIconProps {
  type?: 'story' | 'bug' | 'task' | 'subtask' | string;
  className?: string;
}

export function IssueTypeIcon({ type = 'task', className = 'w-4 h-4' }: IssueTypeIconProps) {
  const normalized = (type || 'task').toLowerCase();

  if (normalized === 'story') {
    return (
      <span
        title="Story"
        aria-label="Story"
        className="inline-flex items-center justify-center text-emerald-500"
      >
        <Bookmark className={className} />
      </span>
    );
  }

  if (normalized === 'bug') {
    return (
      <span
        title="Bug"
        aria-label="Bug"
        className="inline-flex items-center justify-center text-red-500"
      >
        <CircleDot className={className} />
      </span>
    );
  }

  if (normalized === 'subtask' || normalized === 'sub-task') {
    return (
      <span
        title="Sub-task"
        aria-label="Sub-task"
        className="inline-flex items-center justify-center text-cyan-400"
      >
        <CornerDownRight className={className} />
      </span>
    );
  }

  // Default: Task
  return (
    <span
      title="Task"
      aria-label="Task"
      className="inline-flex items-center justify-center text-blue-500"
    >
      <CheckSquare className={className} />
    </span>
  );
}
