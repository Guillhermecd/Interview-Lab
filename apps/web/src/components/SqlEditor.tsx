import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

interface SqlEditorProps {
  value: string;
  // Without it the editor is read only.
  onChange?: (value: string) => void;
  label?: string;
}

// Colors come from the theme tokens (D-46), so they follow light and dark mode.
const editorTheme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'var(--code-bg)', color: 'var(--sx-id)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 0' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text-3)',
    opacity: '0.7',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 14px 0 0' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  // The mark wraps the highlighted keyword, so the color goes on both.
  '.cm-sql-danger, .cm-sql-danger span': { color: 'var(--crit)', fontWeight: '600' },
  '&:has(.cm-content[contenteditable="true"])': {
    outline: '2px solid var(--accent)',
    outlineOffset: '-2px',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sx-kw)', fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sx-str)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sx-num)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--sx-com)' },
  { tag: tags.typeName, color: 'var(--sx-kw)', fontWeight: '500' },
  { tag: tags.standard(tags.name), color: 'var(--sx-fn)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--text-3)' },
]);

// Commands that change data stand out in the critical color. This is display
// only: what may run is decided by the SQL guard in the backend, on the AST.
const DANGER_PATTERN = /\b(?:DELETE|UPDATE|INSERT|DROP|TRUNCATE|ALTER)\b/gi;
const dangerMark = Decoration.mark({ class: 'cm-sql-danger' });
const dangerMatcher = new MatchDecorator({
  regexp: DANGER_PATTERN,
  decorate: (add, from, to, _match, view) => {
    // Only real keywords: the same word inside a string or comment is left alone.
    if (syntaxTree(view.state).resolveInner(from, 1).name === 'Keyword') {
      add(from, to, dangerMark);
    }
  },
});

const dangerHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = dangerMatcher.createDeco(view);
    }

    update(update: ViewUpdate): void {
      this.decorations = dangerMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// CodeMirror 6 with PostgreSQL highlighting (D-30). Read only by default;
// editable when `onChange` is given (review mode, Phase 07).
export function SqlEditor({ value, onChange, label = 'SQL gerado' }: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const editable = onChange !== undefined;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          sql({ dialect: PostgreSQL }),
          syntaxHighlighting(highlightStyle),
          dangerHighlight,
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
          editorTheme,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
    // The editor is created once per mode; later `value` changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, label]);

  // Applies a value set from outside (for example a new SQL from the stream)
  // without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      data-testid={editable ? 'sql-editor' : 'sql-viewer'}
      className="overflow-x-auto bg-code-bg"
    />
  );
}
