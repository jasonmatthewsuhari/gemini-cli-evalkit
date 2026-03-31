/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@google/gemini-cli-core';
import { MessageType } from '../types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const {
  managerMock,
  generateEvalDraftMock,
  getPendingEvalContextMock,
  clearPendingEvalContextMock,
  evalRuleManagerCtorMock,
} = vi.hoisted(() => {
  const manager = {
    readIndex: vi.fn(),
    saveGenerated: vi.fn(),
  };

  return {
    managerMock: manager,
    generateEvalDraftMock: vi.fn(),
    getPendingEvalContextMock: vi.fn(),
    clearPendingEvalContextMock: vi.fn(),
    evalRuleManagerCtorMock: vi.fn(() => manager),
  };
});

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    EvalRuleManager: evalRuleManagerCtorMock,
    generateEvalDraft: generateEvalDraftMock,
    getPendingEvalContext: getPendingEvalContextMock,
    clearPendingEvalContext: clearPendingEvalContextMock,
  };
});

import { generateEvalCommand } from './generateEvalCommand.js';

describe('generateEvalCommand', () => {
  const contentGenerator = {
    generateContent: vi.fn(),
  };

  const config = {
    getProjectRoot: vi.fn(() => '/mock/project'),
    getContentGenerator: vi.fn(() => contentGenerator),
    getModel: vi.fn(() => 'gemini-test'),
    getGeminiClient: vi.fn(() => ({
      getHistory: () => [],
    })),
  } as unknown as Config;

  beforeEach(() => {
    vi.clearAllMocks();
    getPendingEvalContextMock.mockReturnValue(null);
    managerMock.readIndex.mockResolvedValue({
      installed: [],
      generated: [],
    });
    managerMock.saveGenerated.mockResolvedValue(undefined);
  });

  it('saves generated eval metadata including duplicate warnings and contribution assessment', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    generateEvalDraftMock.mockResolvedValue({
      suggestedName: 'download-to-cwd',
      category: 'behavioral',
      evalCode: 'eval code',
      ruleCode: 'rule code',
      duplicateCandidates: ['download-files'],
      contributionAssessment: {
        verdict: 'needs-review',
        reasons: [
          'Compare it against existing evals before contributing upstream.',
        ],
      },
    });

    const result = await generateEvalCommand.action!(
      context,
      'agent should keep downloads in the current directory',
    );

    expect(managerMock.saveGenerated).toHaveBeenCalledWith(
      'download-to-cwd',
      'eval code',
      'rule code',
      'behavioral',
      {
        duplicateCandidates: ['download-files'],
        contributionAssessment: {
          verdict: 'needs-review',
          reasons: [
            'Compare it against existing evals before contributing upstream.',
          ],
        },
      },
    );
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining(
          'Contribution fit: review before upstreaming',
        ),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining(
          'Similar evals to review: download-files',
        ),
      }),
    );
  });

  it('stops on strong duplicates and reports nearby evals', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    generateEvalDraftMock.mockResolvedValue({
      suggestedName: 'download-to-cwd',
      category: 'behavioral',
      evalCode: 'eval code',
      ruleCode: 'rule code',
      duplicateOf: 'download-to-cwd',
      duplicateCandidates: ['download-to-cwd', 'download-files'],
    });

    const result = await generateEvalCommand.action!(
      context,
      'agent should keep downloads in the current directory',
    );

    expect(managerMock.saveGenerated).not.toHaveBeenCalled();
    expect(clearPendingEvalContextMock).toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Already covered by eval 'download-to-cwd'. No new eval generated.\nSimilar evals: download-to-cwd, download-files",
    });
  });
});
