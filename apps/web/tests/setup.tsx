import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

// Type-only, so it is erased before `vi.mock` ever runs.
import type * as ApiClient from '@/lib/api-client';

/**
 * The framework edges a screen touches, stubbed once.
 *
 * Everything mocked here is a boundary the component does not own — routing,
 * transport, sockets, toasts. The component's own markup, states and semantics
 * are exactly what the tests are for, so none of that is stubbed.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- Routing ---------------------------------------------------------------

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

let searchParams = new URLSearchParams();
let pathname = '/';

export function setLocation(next: { pathname?: string; search?: string }): void {
  if (next.pathname !== undefined) pathname = next.pathname;
  if (next.search !== undefined) searchParams = new URLSearchParams(next.search);
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  pathname = '/';
});

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParams,
  usePathname: () => pathname,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// --- Transport -------------------------------------------------------------

// The factory is lazy, so importing the stub from inside it sidesteps the
// hoisting rules that `vi.mock` imposes on module-level bindings.
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClient>('@/lib/api-client');
  const { apiMock } = await import('./helpers/api-mock');
  return { ...actual, api: apiMock };
});

// --- Realtime --------------------------------------------------------------

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  }),
}));

// --- Toasts ----------------------------------------------------------------

export const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  message: vi.fn(),
};

vi.mock('sonner', () => ({
  toast: toastMock,
  Toaster: () => null,
}));

// --- jsdom gaps Radix depends on -------------------------------------------

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
} as unknown as typeof IntersectionObserver;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

window.HTMLElement.prototype.scrollIntoView ??= vi.fn();
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};
