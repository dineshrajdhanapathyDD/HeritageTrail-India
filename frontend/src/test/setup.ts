// Type augmentation only; the runtime entry is externalized and can extend a different `vitest`
// instance than the one the tests use, so the matchers are registered explicitly below.
import type {} from '@testing-library/jest-dom/vitest';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

expect.extend(jestDomMatchers);

// Finish Framer Motion animations instantly so exit transitions do not linger in the DOM.
MotionGlobalConfig.skipAnimations = true;

// jsdom has no ResizeObserver (used by recharts ResponsiveContainer).
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  cleanup();
  // The maplibre mock attaches marker elements to document.body; drop any left behind.
  document.body.innerHTML = '';
});
