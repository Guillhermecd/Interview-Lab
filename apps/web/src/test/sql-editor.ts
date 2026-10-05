import { EditorView } from '@codemirror/view';
import { act, screen } from '@testing-library/react';

// Replaces the whole text of the SQL editor with the given label. jsdom has no
// layout, so typing into CodeMirror is done through its own API.
export function replaceSqlEditorText(label: string, text: string): void {
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: label }));
  if (!view) {
    throw new Error(`No SQL editor labelled "${label}"`);
  }
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}
