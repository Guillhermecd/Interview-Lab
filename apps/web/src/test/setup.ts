import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine; charts, the code editor and auto-scroll only need
// these to exist.
class ResizeObserverStub {
  observe(): void {
    // Nothing to observe without layout.
  }
  unobserve(): void {
    // Nothing to stop observing.
  }
  disconnect(): void {
    // Nothing to disconnect.
  }
}

if (!('ResizeObserver' in globalThis)) {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}

if (!('scrollIntoView' in Element.prototype)) {
  Object.assign(Element.prototype, {
    scrollIntoView: () => {
      // No scrolling without layout.
    },
  });
}

// jsdom does not implement matchMedia; the theme hook reads prefers-color-scheme.
Object.assign(window, {
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});
