import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SqlViewer } from './SqlViewer';

describe('SqlViewer', () => {
  it('shows the SQL, read only', () => {
    render(<SqlViewer sql="SELECT name FROM regions ORDER BY name" />);

    const viewer = screen.getByLabelText('SQL gerado');
    expect(viewer).toHaveTextContent('SELECT name FROM regions ORDER BY name');
    expect(viewer.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('replaces the content when the SQL changes', () => {
    const { rerender } = render(<SqlViewer sql="SELECT 1" />);

    rerender(<SqlViewer sql="SELECT 2" />);

    const viewer = screen.getByLabelText('SQL gerado');
    expect(viewer).toHaveTextContent('SELECT 2');
    expect(viewer).not.toHaveTextContent('SELECT 1');
  });
});
