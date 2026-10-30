import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

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
});
