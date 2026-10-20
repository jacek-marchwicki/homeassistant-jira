import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { AccountType, getAccountType, getAssigneesFromBoard } from '../utils/boardUtils.ts';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
];

/**
 * Dedicated full-screen Settings page. Currently lets the user mark each account
 * as "Parent" (default) or "Child". The choice is stored on the backend and shared
 * by every app member.
 */
export function SettingsView() {
  const {
    issues,
    availableUsers,
    currentUser,
    accountTypes,
    setAccountType,
    closeSettings,
    errorMessage,
    authStatus,
    logout,
  } = useBoardStore();

  const people = useMemo(
    () => getAssigneesFromBoard(issues, availableUsers, currentUser),
    [issues, availableUsers, currentUser]
  );

  return (
    <div className="min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]">
    <main className="p-4 sm:p-6 max-w-3xl w-full mx-auto" aria-label="Settings">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={closeSettings}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] cursor-pointer"
          aria-label="Back to board"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-[var(--jira-text-primary)]">Settings</h1>
      </div>
      {errorMessage && (
        <div role="alert" className="mt-3 text-xs text-red-400">
          {errorMessage}
        </div>
      )}

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
          Shared with everyone using this app.
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

      {authStatus?.authMode === 'gcp_oauth' && authStatus.user && (
        <section className="mt-6 pt-6 border-t border-[var(--jira-border)]" aria-labelledby="settings-account-heading">
          <h2 id="settings-account-heading" className="text-sm font-semibold text-[var(--jira-text-primary)]">
            Signed in account
          </h2>
          <div className="mt-3 p-3 rounded-xl border border-[var(--jira-border)] bg-[var(--jira-surface)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {authStatus.user.picture ? (
                <img
                  src={authStatus.user.picture}
                  alt={authStatus.user.name || authStatus.user.email}
                  className="w-9 h-9 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[var(--jira-primary)]/20 text-[var(--jira-primary)] flex items-center justify-center font-bold text-xs shrink-0">
                  {(authStatus.user.name || authStatus.user.email).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 truncate">
                <p className="text-sm font-medium text-[var(--jira-text-primary)] truncate">
                  {authStatus.user.name || authStatus.user.email}
                </p>
                <p className="text-xs text-[var(--jira-text-secondary)] truncate">
                  {authStatus.user.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="min-h-[36px] px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-semibold cursor-pointer shrink-0 transition-colors"
            >
              Sign out
            </button>
          </div>
        </section>
      )}
    </main>
    </div>
  );
}
