import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, Pencil, Trash2, Check, X, AlertCircle } from 'lucide-react';
import { JiraComment } from '../types/jira.ts';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { getApiUrl } from '../utils/paths.ts';

interface CommentsSectionProps {
  issueKey: string;
}

export function CommentsSection({ issueKey }: CommentsSectionProps) {
  const { currentUser } = useBoardStore();

  const [comments, setComments] = useState<JiraComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCommentBody, setNewCommentBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // Fetch comments
  useEffect(() => {
    let isCancelled = false;
    const fetchComments = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(getApiUrl(`/api/issues/${issueKey}/comments`));
        if (!res.ok) {
          throw new Error(`Failed to load comments (HTTP ${res.status})`);
        }
        const data: JiraComment[] = await res.json();
        if (!isCancelled) {
          setComments(data);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load comments');
          setIsLoading(false);
        }
      }
    };

    fetchComments();
    return () => {
      isCancelled = true;
    };
  }, [issueKey]);

  // Add Comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCommentBody.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          author_name: currentUser || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to add comment (HTTP ${res.status})`);
      }

      const created: JiraComment = await res.json();
      setComments((prev) => [...prev, created]);
      setNewCommentBody('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start Edit
  const handleStartEdit = (comment: JiraComment) => {
    setEditingCommentId(comment.id);
    setEditingBody(comment.body);
    setDeletingCommentId(null);
  };

  // Cancel Edit
  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingBody('');
  };

  // Save Edit
  const handleSaveEdit = async (commentId: string) => {
    const trimmed = editingBody.trim();
    if (!trimmed) return;

    setIsUpdating(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/comments/${commentId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`Failed to update comment (HTTP ${res.status})`);
      }

      const updated: JiraComment = await res.json();
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      setEditingCommentId(null);
      setEditingBody('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update comment');
    } finally {
      setIsUpdating(false);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId: string) => {
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/comments/${commentId}`), {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(`Failed to delete comment (HTTP ${res.status})`);
      }

      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setDeletingCommentId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete comment');
    }
  };

  // Format date helper
  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="pt-4 border-t border-[var(--jira-border)] space-y-4" data-testid="comments-section">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--jira-text-secondary)] flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[var(--jira-primary)]" />
          <span>Comments ({comments.length})</span>
        </h3>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Comment List */}
      {isLoading ? (
        <div className="py-4 text-center text-xs text-[var(--jira-text-muted)] animate-pulse">
          Loading comments...
        </div>
      ) : comments.length === 0 ? (
        <div className="py-3 text-center text-xs text-[var(--jira-text-muted)] bg-[var(--jira-canvas)]/40 rounded-lg border border-[var(--jira-border-subtle)]">
          No comments yet. Be the first to add one!
        </div>
      ) : (
        <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
          {comments.map((comment) => {
            const isEditing = editingCommentId === comment.id;
            const isDeleting = deletingCommentId === comment.id;

            return (
              <div
                key={comment.id}
                className="p-3 rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] transition-colors hover:border-[var(--jira-border-subtle)]"
                data-testid={`comment-item-${comment.id}`}
              >
                {/* Comment Header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 truncate">
                    <AssigneeAvatar assignee={comment.author} sizeClassName="w-5 h-5 shrink-0" />
                    <span className="text-xs font-semibold text-[var(--jira-text-primary)] truncate">
                      {comment.author?.displayName || comment.author?.display_name || 'Anonymous'}
                    </span>
                    <span className="text-2xs text-[var(--jira-text-muted)] whitespace-nowrap">
                      {formatDate(comment.created)}
                      {comment.updated && ' (edited)'}
                    </span>
                  </div>

                  {/* Actions (Edit / Delete) */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      {isDeleting ? (
                        <div className="flex items-center gap-1.5 animate-in fade-in duration-100">
                          <span className="text-2xs text-red-400 font-semibold">Delete?</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(comment.id)}
                            className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                            title="Confirm Delete"
                            aria-label={`Confirm delete comment ${comment.id}`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingCommentId(null)}
                            className="p-1 rounded text-[var(--jira-text-muted)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                            title="Cancel Delete"
                            aria-label={`Cancel delete comment ${comment.id}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartEdit(comment)}
                            className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                            title="Edit Comment"
                            aria-label={`Edit comment ${comment.id}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingCommentId(comment.id)}
                            className="p-1 rounded text-[var(--jira-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Delete Comment"
                            aria-label={`Delete comment ${comment.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Comment Body or Inline Editor */}
                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)] resize-y"
                      placeholder="Edit comment..."
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={isUpdating}
                        className="px-2.5 py-1 text-2xs font-medium rounded-md border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(comment.id)}
                        disabled={isUpdating || !editingBody.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 text-2xs font-semibold rounded-md bg-[var(--jira-primary)] text-white hover:bg-[var(--jira-primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isUpdating ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--jira-text-primary)] whitespace-pre-wrap leading-relaxed">
                    {comment.body}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add New Comment Box */}
      <form onSubmit={handleAddComment} className="mt-2 space-y-2">
        <div className="relative">
          <textarea
            value={newCommentBody}
            onChange={(e) => setNewCommentBody(e.target.value)}
            rows={2}
            placeholder="Add a comment..."
            className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)] resize-y"
            aria-label="Add a comment"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-2xs text-[var(--jira-text-muted)]">
            Commenting as <span className="font-semibold text-[var(--jira-text-secondary)]">{currentUser}</span>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !newCommentBody.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Posting...' : 'Comment'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
