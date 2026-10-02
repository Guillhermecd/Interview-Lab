import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

// A component testing library is only chosen in Phase 06; server rendering is
// enough to prove the web test pipeline (TSX transform + Vitest) works.
describe('App', () => {
  it('renders the product title', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<h1>Converse com seus dados</h1>');
  });
});
