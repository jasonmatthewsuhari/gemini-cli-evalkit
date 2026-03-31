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
  analyzeCoverageMock,
  generateEvalDraftMock,
  fetchEvalRegistryWithStatusMock,
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
    analyzeCoverageMock: vi.fn(),
    generateEvalDraftMock: vi.fn(),
    fetchEvalRegistryWithStatusMock: vi.fn(),
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
    analyzeCoverage: analyzeCoverageMock,
    generateEvalDraft: generateEvalDraftMock,
    fetchEvalRegistryWithStatus: fetchEvalRegistryWithStatusMock,
    getPendingEvalContext: getPendingEvalContextMock,
    clearPendingEvalContext: clearPendingEvalContextMock,
  };
});

import { evalsCommand } from './evalsCommand.js';
import { generateEvalCommand } from './generateEvalCommand.js';

describe('eval contributor workflow', () => {
  const config = {
    getProjectRoot: vi.fn(() => '/mock/project'),
    getContentGenerator: vi.fn(() => ({ generateContent: vi.fn() })),
    getModel: vi.fn(() => 'gemini-test'),
    getGeminiClient: vi.fn(() => ({
      getHistory: () => [],
    })),
  } as unknown as Config;

  beforeEach(() => {
    vi.clearAllMocks();

    managerMock.readIndex.mockResolvedValue({
      installed: [],
      generated: [],
    });
    managerMock.saveGenerated.mockResolvedValue(undefined);

    analyzeCoverageMock.mockResolvedValue({
      tools: [{ name: 'google_web_search', evalCount: 0, isGap: true }],
      behavioral: [{ category: 'tool-selection', evalCount: 0, isGap: true }],
      suggestions: [
        {
          kind: 'tool',
          target: 'google_web_search',
          category: 'tool-selection',
          prompt:
            'agent should use google_web_search before answering requests for current or fast-changing information',
          rationale:
            'Current-information failures are common and highly visible to users.',
          upstreamPotential: 'high',
        },
      ],
      totalGaps: 2,
      generatedAt: '2026-03-31T00:00:00.000Z',
    });

    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-31T00:00:00.000Z',
        evals: [],
      },
      source: 'network',
      stale: false,
      fetchedAt: '2026-03-31T00:00:00.000Z',
    });

    generateEvalDraftMock.mockResolvedValue({
      suggestedName: 'current-info-search',
      category: 'behavioral',
      evalCode: 'eval code',
      ruleCode: 'rule code',
      duplicateCandidates: [],
      contributionAssessment: {
        verdict: 'likely-upstream',
        reasons: [
          'The described behavior looks broadly applicable to Gemini CLI users.',
        ],
      },
    });

    getPendingEvalContextMock.mockReturnValue(null);
  });

  it('turns a coverage suggestion into a saved local eval', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    const coverageCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'coverage',
    );
    await coverageCommand!.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.EVALS_COVERAGE,
        suggestions: expect.arrayContaining([
          expect.objectContaining({ target: 'google_web_search' }),
        ]),
      }),
    );

    const result = await generateEvalCommand.action!(
      context,
      'agent should use google_web_search before answering requests for current or fast-changing information',
    );

    expect(managerMock.saveGenerated).toHaveBeenCalledWith(
      'current-info-search',
      'eval code',
      'rule code',
      'behavioral',
      expect.objectContaining({
        contributionAssessment: expect.objectContaining({
          verdict: 'likely-upstream',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining("Saved 'current-info-search'."),
      }),
    );
  });
});
