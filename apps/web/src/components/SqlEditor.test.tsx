import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SqlEditor } from './SqlEditor';

describe('SqlEditor', () => {
  it('shows the SQL read only by default', () => {
    render(<SqlEditor value="SELECT name FROM regions ORDER BY name" />);

    const viewer = screen.getByTestId('sql-viewer');
    expect(viewer).toHaveTextContent('SELECT name FROM regions ORDER BY name');
    expect(viewer.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('is editable when it has an onChange', () => {
    render(<SqlEditor value="SELECT 1" onChange={vi.fn()} label="SQL para revisar" />);

    const editor = screen.getByTestId('sql-editor');
    expect(editor.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'SQL para revisar' })).toBeInTheDocument();
  });

  it('replaces the content when the value changes', () => {
    const { rerender } = render(<SqlEditor value="SELECT 1" />);

    rerender(<SqlEditor value="SELECT 2" />);

    const viewer = screen.getByTestId('sql-viewer');
    expect(viewer).toHaveTextContent('SELECT 2');
    expect(viewer).not.toHaveTextContent('SELECT 1');
  });
});
