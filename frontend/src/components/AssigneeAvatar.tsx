import { useState } from 'react';
import { JiraUser } from '../types/jira.ts';

/**
 * Extracts 1-2 uppercase initials from a user's display name.
 * Examples:
 * - "Jacek Marchwicki" -> "JM"
 * - "Alex Lead" -> "AL"
 * - "Admin" -> "AD"
 * - "" / undefined -> "?"
 */
export function getInitials(name?: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AssigneeAvatarProps {
  assignee?: JiraUser;
  sizeClassName?: string;
}

/**
 * Robust Assignee Avatar component.
 * - Always renders high-contrast initials as the base layer.
 * - If avatar_url is provided, overlays the image progressively once loaded.
 * - If image fails to load (offline, network error, 404), unmounts image cleanly
 *   and retains initials without displaying broken image boxes or blank circles.
 * - Renders "-" for unassigned issues.
 */
export function AssigneeAvatar({ assignee, sizeClassName = 'w-6 h-6' }: AssigneeAvatarProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (!assignee) {
    return (
      <div
        className={`${sizeClassName} rounded-full bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-2xs flex items-center justify-center text-[var(--jira-text-secondary)] select-none`}
        title="Unassigned"
      >
        -
      </div>
    );
  }

  const displayName = assignee.displayName || assignee.display_name;
  const initials = getInitials(displayName);
  const avatarUrl = assignee.avatarUrl || assignee.avatar_url;

  return (
    <div
      className={`relative ${sizeClassName} rounded-full bg-blue-600 flex items-center justify-center text-2xs font-bold text-white shadow-sm overflow-hidden select-none`}
      title={displayName || 'Assignee'}
    >
      <span>{initials}</span>
      {avatarUrl && !imgError && (
        <img
          src={avatarUrl}
          alt={displayName || 'Assignee'}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}
