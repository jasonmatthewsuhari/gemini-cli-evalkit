/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { canShowAutoApproveCheckbox } from './commandAllowlist.js';
import * as shellUtils from './shell-utils.js';

// Mock getCommandRoots to test the logic directly without needing the wasm parser to be fully loaded
vi.mock('./shell-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shell-utils.js')>();
  return {
    ...actual,
    getCommandRoots: vi.fn(),
  };
});

describe('commandAllowlist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canShowAutoApproveCheckbox', () => {
    describe('safe commands in default mode', () => {
      it.each([
        ['ls -la', ['ls']],
        ['cat file | grep "test"', ['grep', 'cat']],
      ])('should return true for %s', (cmd: string, roots: string[]) => {
        vi.mocked(shellUtils.getCommandRoots).mockReturnValue(roots);
        expect(canShowAutoApproveCheckbox(cmd, false)).toBe(true);
      });
    });

    describe('edit commands in default mode', () => {
      it.each([
        ['mkdir test', ['mkdir']],
        ['touch file.txt', ['touch']],
      ])('should return false for %s', (cmd: string, roots: string[]) => {
        vi.mocked(shellUtils.getCommandRoots).mockReturnValue(roots);
        expect(canShowAutoApproveCheckbox(cmd, false)).toBe(false);
      });
    });

    describe('edit commands in accept-edits mode', () => {
      it.each([
        ['mkdir test', ['mkdir']],
        ['touch file.txt', ['touch']],
      ])('should return true for %s', (cmd: string, roots: string[]) => {
        vi.mocked(shellUtils.getCommandRoots).mockReturnValue(roots);
        expect(canShowAutoApproveCheckbox(cmd, true)).toBe(true);
      });
    });

    describe('destructive commands in any mode', () => {
      it.each([
        ['rm -rf /', ['rm'], false],
        ['rm -rf /', ['rm'], true],
        ['mkfs.ext4 /dev/sda1', ['mkfs'], true],
        ['format C:', ['format'], true],
      ])(
        'should return false for %s in acceptEdits=%s',
        (cmd: string, roots: string[], isAcceptEdits: boolean) => {
          vi.mocked(shellUtils.getCommandRoots).mockReturnValue(roots);
          expect(canShowAutoApproveCheckbox(cmd, isAcceptEdits)).toBe(false);
        },
      );
    });

    it('should return false for pipelines where one command is destructive', () => {
      vi.mocked(shellUtils.getCommandRoots).mockReturnValue(['ls', 'rm']);
      expect(canShowAutoApproveCheckbox('ls | xargs rm', true)).toBe(false);
    });

    it('should return false if getCommandRoots returns empty (e.g., parsing failed or no command)', () => {
      vi.mocked(shellUtils.getCommandRoots).mockReturnValue([]);
      expect(canShowAutoApproveCheckbox('', true)).toBe(false);
    });
  });
});
