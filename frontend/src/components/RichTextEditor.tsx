import React, { useState, useRef, useCallback } from 'react';
import {
  Bold,
  Italic,
  Heading,
  List,
  ListOrdered,
  Code,
  Quote,
  Link as LinkIcon,
  Eye,
  Pencil,
} from 'lucide-react';

interface RichTextEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  defaultTab?: 'write' | 'preview';
}

/**
 * Parses markdown text into formatted React elements safely without external dependencies.
 */
export function renderRichText(markdown: string): React.ReactNode {
  if (!markdown || !markdown.trim()) {
    return (
      <span className="text-[var(--jira-text-muted)] italic text-xs">
        No description provided.
      </span>
    );
  }

  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockBuffer: string[] = [];
  let currentListItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && listType) {
      if (listType === 'ul') {
        elements.push(
          <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 my-2 text-xs">
            {currentListItems}
          </ul>
        );
      } else {
        elements.push(
          <ol key={`list-${elements.length}`} className="list-decimal list-inside space-y-1 my-2 text-xs">
            {currentListItems}
          </ol>
        );
      }
      currentListItems = [];
      listType = null;
    }
  };

  const parseInline = (text: string): React.ReactNode[] => {
    // Basic inline markdown: bold, italic, code, link
    const parts: React.ReactNode[] = [];
    // Regex matching: links [text](url), code `text`, bold **text**, italic *text*
    const tokenRegex = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      if (match[2] && match[3]) {
        // Link [text](url)
        const href = match[3].trim();
        const isSafe = /^https?:\/\//i.test(href) || href.startsWith('/');
        parts.push(
          <a
            key={`inline-${match.index}`}
            href={isSafe ? href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--jira-primary)] underline hover:opacity-80"
          >
            {match[2]}
          </a>
        );
      } else if (match[4]) {
        // Inline code `code`
        parts.push(
          <code
            key={`inline-${match.index}`}
            className="px-1.5 py-0.5 rounded font-mono text-2xs bg-[var(--jira-surface)] border border-[var(--jira-border)] text-pink-400"
          >
            {match[4]}
          </code>
        );
      } else if (match[5]) {
        // Bold **text**
        parts.push(
          <strong key={`inline-${match.index}`} className="font-bold text-[var(--jira-text-primary)]">
            {match[5]}
          </strong>
        );
      } else if (match[6]) {
        // Italic *text*
        parts.push(
          <em key={`inline-${match.index}`} className="italic text-[var(--jira-text-primary)]">
            {match[6]}
          </em>
        );
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle (```)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            className="p-3 my-2 rounded-lg bg-[var(--jira-surface)] border border-[var(--jira-border)] font-mono text-xs overflow-x-auto text-[var(--jira-text-primary)]"
          >
            <code>{codeBlockBuffer.join('\n')}</code>
          </pre>
        );
        codeBlockBuffer = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockBuffer.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={`h3-${i}`} className="text-xs font-bold text-[var(--jira-text-primary)] mt-3 mb-1">
          {parseInline(line.slice(4))}
        </h4>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={`h2-${i}`} className="text-sm font-bold text-[var(--jira-text-primary)] mt-3 mb-1">
          {parseInline(line.slice(3))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={`h1-${i}`} className="text-base font-bold text-[var(--jira-text-primary)] mt-3 mb-1">
          {parseInline(line.slice(2))}
        </h2>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="pl-3 my-2 border-l-2 border-[var(--jira-primary)] text-xs italic text-[var(--jira-text-secondary)]"
        >
          {parseInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered List (- or *)
    const ulMatch = /^(\s*)[-*]\s+(.+)$/.exec(line);
    if (ulMatch) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      currentListItems.push(
        <li key={`li-${i}`} className="text-[var(--jira-text-primary)]">
          {parseInline(ulMatch[2])}
        </li>
      );
      continue;
    }

    // Ordered List (1.)
    const olMatch = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      currentListItems.push(
        <li key={`li-${i}`} className="text-[var(--jira-text-primary)]">
          {parseInline(olMatch[2])}
        </li>
      );
      continue;
    }

    flushList();

    // Regular paragraph or empty line
    if (line.trim() === '') {
      elements.push(<div key={`empty-${i}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="text-xs text-[var(--jira-text-primary)] leading-relaxed">
          {parseInline(line)}
        </p>
      );
    }
  }

  flushList();

  if (inCodeBlock && codeBlockBuffer.length > 0) {
    elements.push(
      <pre
        key="code-final"
        className="p-3 my-2 rounded-lg bg-[var(--jira-surface)] border border-[var(--jira-border)] font-mono text-xs overflow-x-auto text-[var(--jira-text-primary)]"
      >
        <code>{codeBlockBuffer.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}

export function RichTextEditor({
  id = 'rich-text-editor',
  value,
  onChange,
  placeholder = 'Add details, formatted text, or markdown...',
  rows = 3,
  disabled = false,
  className = '',
  defaultTab = 'write',
}: RichTextEditorProps) {
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>(defaultTab);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyFormatting = useCallback(
    (prefix: string, suffix: string = '', defaultText: string = 'text') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const selected = text.substring(start, end);

      const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${defaultText}${suffix}`;
      const nextValue = text.substring(0, start) + replacement + text.substring(end);

      onChange(nextValue);

      // Restore cursor position after change
      setTimeout(() => {
        textarea.focus();
        const cursorStart = start + prefix.length;
        const cursorEnd = cursorStart + (selected ? selected.length : defaultText.length);
        textarea.setSelectionRange(cursorStart, cursorEnd);
      }, 0);
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      applyFormatting('**', '**', 'bold text');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      applyFormatting('*', '*', 'italic text');
    }
  };

  return (
    <div
      className={`w-full rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] overflow-hidden focus-within:border-[var(--jira-primary)] transition-all ${className}`}
      data-testid="rich-text-editor"
    >
      {/* Editor Header Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]/50">
        {/* Write / Preview Tab Switcher */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('write')}
            className={`flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'write'
                ? 'bg-[var(--jira-surface)] text-[var(--jira-primary)] shadow-2xs border border-[var(--jira-border)]'
                : 'text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)]'
            }`}
            aria-label="Write tab"
          >
            <Pencil className="w-3 h-3" />
            <span>Write</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'preview'
                ? 'bg-[var(--jira-surface)] text-[var(--jira-primary)] shadow-2xs border border-[var(--jira-border)]'
                : 'text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)]'
            }`}
            aria-label="Preview tab"
          >
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </button>
        </div>

        {/* Formatting Toolbar (Active only in Write mode) */}
        {activeTab === 'write' && (
          <div className="flex items-center gap-0.5 text-[var(--jira-text-muted)]">
            <button
              type="button"
              onClick={() => applyFormatting('**', '**', 'bold text')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Bold (Ctrl+B)"
              aria-label="Format Bold"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('*', '*', 'italic text')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Italic (Ctrl+I)"
              aria-label="Format Italic"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('### ', '', 'Heading')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Heading 3"
              aria-label="Format Heading"
            >
              <Heading className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('- ', '', 'list item')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Bulleted List"
              aria-label="Format Bullet List"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('1. ', '', 'numbered item')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Numbered List"
              aria-label="Format Numbered List"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('`', '`', 'code')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Code Snippet"
              aria-label="Format Code"
            >
              <Code className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('> ', '', 'quote')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Quote"
              aria-label="Format Quote"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('[', '](https://example.com)', 'link text')}
              disabled={disabled}
              className="p-1 rounded hover:bg-[var(--jira-surface-hover)] hover:text-[var(--jira-text-primary)] transition-colors cursor-pointer disabled:opacity-40"
              title="Link"
              aria-label="Format Link"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Editor Content Area */}
      {activeTab === 'write' ? (
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className="w-full px-3 py-2 text-sm bg-transparent text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none resize-y min-h-[80px]"
        />
      ) : (
        <div
          className="w-full p-3 text-sm min-h-[80px] bg-[var(--jira-canvas)] overflow-y-auto max-h-56"
          data-testid="rich-text-preview"
        >
          {renderRichText(value)}
        </div>
      )}
    </div>
  );
}
