import { useMemo } from 'react';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { AccountType, getAccountType, getAssigneesFromBoard } from '../utils/boardUtils.ts';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
];

/**
 * Dedicated Settings screen. Currently lets the user mark each account as
 * "Parent" (default) or "Child".
 */
export function SettingsView() {
  const { issues, availableUsers, currentUser, accountTypes, setAccountType } = useBoardStore();

  const people = useMemo(
    () => getAssigneesFromBoard(issues, availableUsers, currentUser),
    [issues, availableUsers, currentUser]
  );

  return (
    <main className="flex-1 p-4 sm:p-6 max-w-3xl w-full mx-auto" aria-label="Settings">
      <h1 className="text-lg font-bold text-[var(--jira-text-primary)]">Settings</h1>

      <section className="mt-4" aria-labelledby="settings-accounts-heading">
        <h2
          id="settings-accounts-heading"
          className="text-sm font-semibold text-[var(--jira-text-primary)]"
        >
          Account types
        </h2>
        <p className="text-xs text-[var(--jira-text-secondary)] mt-1">
          Children don&apos;t see unassigned tasks in &quot;Assigned to Me&quot; or on the People
          board. Parents can reveal children&apos;s tasks with the &quot;Show child&quot; switch.
          Stored in this browser.
        </p>

        <ul className="mt-3 divide-y divide-[var(--jira-border)] rounded-xl border border-[var(--jira-border)] bg-[var(--jira-surface)]">
          {people.map((person) => {
            const type = getAccountType(accountTypes, person.displayName);
            return (
              <li
                key={person.displayName}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AssigneeAvatar
                    assignee={{ displayName: person.displayName, avatarUrl: person.avatarUrl }}
                    sizeClassName="w-6 h-6 shrink-0"
                  />
                  <span className="truncate text-sm text-[var(--jira-text-primary)]">
                    {person.displayName}
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label={`Account type for ${person.displayName}`}
                  className="flex shrink-0 rounded-lg border border-[var(--jira-border)] overflow-hidden"
                >
                  {ACCOUNT_TYPES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={type === opt.value}
                      aria-label={`${person.displayName} ${opt.label}`}
                      onClick={() => setAccountType(person.displayName, opt.value)}
                      className={`min-h-[44px] min-w-[44px] px-3 text-xs font-medium cursor-pointer transition-colors ${
                        type === opt.value
                          ? 'bg-[var(--jira-primary)] text-white font-semibold'
                          : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
