import { vi } from 'vitest';

/**
 * The transport stub, kept in its own module so `setup.tsx` can register it
 * before any screen is imported while tests still get a stable reference.
 */
export const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};
