import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// The default wait (1 s) is sometimes too short for the first render of a
// screen while every test file is loading its modules at the same time.
configure({ asyncUtilTimeout: 3000 });

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
