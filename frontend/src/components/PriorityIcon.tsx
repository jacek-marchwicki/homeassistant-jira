import {
  ChevronsUp,
  ChevronUp,
  ArrowRight,
  ArrowDown,
  ChevronsDown,
} from 'lucide-react';
import { JiraPriority } from '../types/jira.ts';

export interface PriorityIconProps {
  priority: JiraPriority | string;
  className?: string;
}

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const norm = (priority || 'medium').toLowerCase();

  switch (norm) {
    case 'highest':
      return (
        <span title="Priority: Highest" className="inline-flex items-center shrink-0">
          <ChevronsUp
            className={className || 'w-4 h-4 text-[var(--jira-priority-highest)] shrink-0'}
            aria-label="Highest Priority"
          />
        </span>
      );
    case 'high':
      return (
        <span title="Priority: High" className="inline-flex items-center shrink-0">
          <ChevronUp
            className={className || 'w-4 h-4 text-[var(--jira-priority-high)] shrink-0'}
            aria-label="High Priority"
          />
        </span>
      );
    case 'medium':
      return (
        <span title="Priority: Medium" className="inline-flex items-center shrink-0">
          <ArrowRight
            className={className || 'w-4 h-4 text-[var(--jira-priority-medium)] shrink-0'}
            aria-label="Medium Priority"
          />
        </span>
      );
    case 'lowest':
      return (
        <span title="Priority: Lowest" className="inline-flex items-center shrink-0">
          <ChevronsDown
            className={className || 'w-4 h-4 text-[var(--jira-priority-lowest)] shrink-0'}
            aria-label="Lowest Priority"
          />
        </span>
      );
    case 'low':
    default:
      return (
        <span title="Priority: Low" className="inline-flex items-center shrink-0">
          <ArrowDown
            className={className || 'w-4 h-4 text-[var(--jira-priority-low)] shrink-0'}
            aria-label="Low Priority"
          />
        </span>
      );
  }
}
