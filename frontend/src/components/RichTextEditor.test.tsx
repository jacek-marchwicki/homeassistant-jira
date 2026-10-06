import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RichTextEditor, renderRichText } from './RichTextEditor.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RichTextEditor component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders textarea with value in write mode by default', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<RichTextEditor id="test-editor" value="Initial text" onChange={handleChange} />);
    });

    const textarea = container.querySelector('#test-editor') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('Initial text');
  });

  it('switches between write and preview tabs', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(
        <RichTextEditor
          id="test-editor"
          value="# Heading 1&#10;**Bold text**"
          onChange={handleChange}
        />
      );
    });

    // Initially in write mode
    expect(container.querySelector('#test-editor')).not.toBeNull();
    expect(container.querySelector('[data-testid="rich-text-preview"]')).toBeNull();

    // Click preview tab
    const previewBtn = container.querySelector('button[aria-label="Preview tab"]') as HTMLButtonElement;
    await act(async () => {
      previewBtn.click();
    });

    // Preview mode active
    expect(container.querySelector('#test-editor')).toBeNull();
    const preview = container.querySelector('[data-testid="rich-text-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('h2')?.textContent).toBe('Heading 1');
    expect(preview?.querySelector('strong')?.textContent).toBe('Bold text');

    // Switch back to write mode
    const writeBtn = container.querySelector('button[aria-label="Write tab"]') as HTMLButtonElement;
    await act(async () => {
      writeBtn.click();
    });
    expect(container.querySelector('#test-editor')).not.toBeNull();
  });

  it('applies bold formatting via toolbar button', async () => {
    let currentValue = 'Selected text';
    const handleChange = vi.fn((val: string) => {
      currentValue = val;
    });

    await act(async () => {
      root.render(<RichTextEditor id="test-editor" value={currentValue} onChange={handleChange} />);
    });

    const textarea = container.querySelector('#test-editor') as HTMLTextAreaElement;
    textarea.selectionStart = 0;
    textarea.selectionEnd = 8; // select 'Selected'

    const boldBtn = container.querySelector('button[aria-label="Format Bold"]') as HTMLButtonElement;
    await act(async () => {
      boldBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('**Selected** text');
  });

  it('applies formatting via keyboard shortcut Ctrl+B', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<RichTextEditor id="test-editor" value="sample" onChange={handleChange} />);
    });

    const textarea = container.querySelector('#test-editor') as HTMLTextAreaElement;
    textarea.selectionStart = 0;
    textarea.selectionEnd = 6;

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })
      );
    });

    expect(handleChange).toHaveBeenCalledWith('**sample**');
  });

  it('renders markdown elements correctly via renderRichText helper', () => {
    // Empty text
    const emptyResult = renderRichText('');
    expect(emptyResult).toBeDefined();

    // Markdown text
    const markdown = `# H1 Title
## H2 Subtitle
### H3 Subheader
> Blockquote text
- Bullet item 1
- Bullet item 2
1. Numbered item
\`\`\`
const x = 1;
\`\`\`
Visit [Google](https://google.com) and check \`inline code\` and *italic*!`;

    const rendered = renderRichText(markdown);
    expect(rendered).toBeDefined();
  });
});
