/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import {
  useAlternateBuffer,
  isAlternateBufferEnabled,
} from './useAlternateBuffer.js';
import type { Config } from '@google/gemini-cli-core';

vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: vi.fn(),
}));

const mockUseUIState = vi.mocked(
  await import('../contexts/UIStateContext.js').then((m) => m.useUIState),
);

describe('useAlternateBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when isAlternateBuffer is false', () => {
    mockUseUIState.mockReturnValue({
      isAlternateBuffer: false,
    } as unknown as ReturnType<typeof mockUseUIState>);

    const { result } = renderHook(() => useAlternateBuffer());
    expect(result.current).toBe(false);
  });

  it('should return true when isAlternateBuffer is true', () => {
    mockUseUIState.mockReturnValue({
      isAlternateBuffer: true,
    } as unknown as ReturnType<typeof mockUseUIState>);

    const { result } = renderHook(() => useAlternateBuffer());
    expect(result.current).toBe(true);
  });

  it('should react to UIState changes', () => {
    let mockIsAlternateBuffer = true;
    mockUseUIState.mockImplementation(
      () =>
        ({
          isAlternateBuffer: mockIsAlternateBuffer,
        }) as unknown as ReturnType<typeof mockUseUIState>,
    );

    const { result, rerender } = renderHook(() => useAlternateBuffer());

    // Value should remain true even after rerender
    expect(result.current).toBe(true);

    mockIsAlternateBuffer = false;
    rerender();

    expect(result.current).toBe(false);
  });
});

describe('isAlternateBufferEnabled', () => {
  it('should return true when config.getUseAlternateBuffer returns true', () => {
    const config = {
      getUseAlternateBuffer: () => true,
    } as unknown as Config;

    expect(isAlternateBufferEnabled(config)).toBe(true);
  });

  it('should return false when config.getUseAlternateBuffer returns false', () => {
    const config = {
      getUseAlternateBuffer: () => false,
    } as unknown as Config;

    expect(isAlternateBufferEnabled(config)).toBe(false);
  });
});
