import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';

interface SqlViewerProps {
  sql: string;
}

const viewerTheme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '&.cm-focused': { outline: 'none' },
});

// Read-only SQL with PostgreSQL highlighting (D-30). Editing comes in Phase 07.
export function SqlViewer({ sql: text }: SqlViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: text,
        extensions: [
          sql({ dialect: PostgreSQL }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          viewerTheme,
        ],
      }),
    });
    return () => {
      view.destroy();
    };
  }, [text]);

  return (
    <div
      ref={containerRef}
      aria-label="SQL gerado"
      className="overflow-x-auto rounded-lg border border-border bg-surface-sunken px-2 py-1"
    />
  );
}
