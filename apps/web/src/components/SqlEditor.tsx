import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';

interface SqlEditorProps {
  value: string;
  // Without it the editor is read only.
  onChange?: (value: string) => void;
  label?: string;
}

const editorTheme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '&.cm-focused': { outline: 'none' },
});

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
          sql({ dialect: PostgreSQL }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.lineWrapping,
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
      className={`overflow-x-auto rounded-lg border px-2 py-1 ${
        editable ? 'border-primary bg-surface' : 'border-border bg-surface-sunken'
      }`}
    />
  );
}
