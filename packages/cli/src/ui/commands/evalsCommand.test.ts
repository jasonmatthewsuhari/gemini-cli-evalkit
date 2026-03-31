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
  fetchEvalRegistryWithStatusMock,
  analyzeCoverageMock,
  evalRuleManagerCtorMock,
} = vi.hoisted(() => {
  const manager = {
    readIndex: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    setEnabled: vi.fn(),
    deleteGenerated: vi.fn(),
  };

  return {
    managerMock: manager,
    fetchEvalRegistryWithStatusMock: vi.fn(),
    analyzeCoverageMock: vi.fn(),
    evalRuleManagerCtorMock: vi.fn(() => manager),
  };
});

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    EvalRuleManager: evalRuleManagerCtorMock,
    fetchEvalRegistryWithStatus: fetchEvalRegistryWithStatusMock,
    analyzeCoverage: analyzeCoverageMock,
  };
});

import { evalsCommand } from './evalsCommand.js';

describe('evalsCommand', () => {
  const projectRoot = '/mock/project';

  const config = {
    getProjectRoot: vi.fn(() => projectRoot),
    getContentGenerator: vi.fn(() => null),
    getModel: vi.fn(() => 'gemini-test'),
  } as unknown as Config;

  beforeEach(() => {
    vi.clearAllMocks();

    managerMock.readIndex.mockResolvedValue({
      installed: [],
      generated: [],
    });
    managerMock.install.mockResolvedValue(undefined);
    managerMock.uninstall.mockResolvedValue(undefined);
    managerMock.setEnabled.mockResolvedValue(undefined);
    managerMock.deleteGenerated.mockResolvedValue(undefined);

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

    analyzeCoverageMock.mockResolvedValue({
      tools: [],
      behavioral: [],
      suggestions: [],
      totalGaps: 0,
      generatedAt: '2026-03-31T00:00:00.000Z',
    });
  });

  it('adds an installed eval list for /evals list', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    managerMock.readIndex.mockResolvedValue({
      installed: [
        {
          name: 'no-edit-on-inspect',
          source: 'official',
          installedAt: '2026-03-20T00:00:00.000Z',
          enabled: true,
          ruleFile: '.gemini/eval-rules/no-edit-on-inspect.rule.md',
          analytics: { runs: 12, passes: 11, passRate: 11 / 12 },
        },
      ],
      generated: [
        {
          name: 'download-to-cwd',
          source: 'generated',
          generatedAt: '2026-03-28T00:00:00.000Z',
          enabled: false,
          description: 'Keep downloads in the current directory',
          evalFile: '.gemini/evals/download-to-cwd.eval.ts',
          ruleFile: '.gemini/eval-rules/download-to-cwd.rule.md',
          analytics: { runs: 3, passes: 3, passRate: 1 },
        },
      ],
    });
    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-31T00:00:00.000Z',
        evals: [
          {
            name: 'no-edit-on-inspect',
            description: 'Do not edit files during inspection requests',
            category: 'behavioral',
            evalFile: 'evals/answer-vs-act.eval.ts',
            ruleFragment: 'When asked to inspect, do not edit.',
            author: 'google',
            official: true,
            addedAt: '2026-01-15T00:00:00.000Z',
          },
        ],
      },
      source: 'network',
      stale: false,
      fetchedAt: '2026-03-31T00:00:00.000Z',
    });

    const listCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'list',
    );
    await listCommand!.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.EVALS_LIST,
        title: 'Installed Eval-Rule Combos',
        view: 'installed',
        combos: expect.arrayContaining([
          expect.objectContaining({
            name: 'no-edit-on-inspect',
            category: 'behavioral',
            installed: true,
            enabled: true,
          }),
          expect.objectContaining({
            name: 'download-to-cwd',
            category: 'generated',
            installed: true,
            enabled: false,
          }),
        ]),
      }),
    );
  });

  it('adds a marketplace list for /evals browse', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    managerMock.readIndex.mockResolvedValue({
      installed: [
        {
          name: 'no-edit-on-inspect',
          source: 'official',
          installedAt: '2026-03-20T00:00:00.000Z',
          enabled: false,
          ruleFile: '.gemini/eval-rules/no-edit-on-inspect.rule.md',
          analytics: { runs: 8, passes: 7, passRate: 0.875 },
        },
      ],
      generated: [],
    });
    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-31T00:00:00.000Z',
        evals: [
          {
            name: 'no-edit-on-inspect',
            description: 'Do not edit files during inspection requests',
            category: 'behavioral',
            evalFile: 'evals/answer-vs-act.eval.ts',
            ruleFragment: 'When asked to inspect, do not edit.',
            author: 'google',
            official: true,
            addedAt: '2026-01-15T00:00:00.000Z',
          },
          {
            name: 'shell-safety',
            description: 'Avoid destructive shell usage without confirmation',
            category: 'security',
            evalFile: 'evals/shell-safety.eval.ts',
            ruleFragment: 'Ask before destructive shell commands.',
            author: 'community',
            official: false,
            addedAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
      source: 'network',
      stale: false,
      fetchedAt: '2026-03-31T00:00:00.000Z',
    });

    const browseCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'browse',
    );
    await browseCommand!.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.EVALS_LIST,
        title: 'Eval Marketplace',
        view: 'marketplace',
        combos: expect.arrayContaining([
          expect.objectContaining({
            name: 'no-edit-on-inspect',
            installed: true,
            enabled: false,
            source: 'official',
          }),
          expect.objectContaining({
            name: 'shell-safety',
            installed: false,
            enabled: false,
            source: 'community',
          }),
        ]),
      }),
    );
  });

  it('adds a coverage report for /evals coverage', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    analyzeCoverageMock.mockResolvedValue({
      tools: [{ name: 'google_web_search', evalCount: 0, isGap: true }],
      behavioral: [{ category: 'error-recovery', evalCount: 0, isGap: true }],
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

    const coverageCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'coverage',
    );
    await coverageCommand!.action!(context, '');

    expect(analyzeCoverageMock).toHaveBeenCalledWith(
      expect.stringContaining('.gemini'),
    );
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.EVALS_COVERAGE,
        suggestions: expect.arrayContaining([
          expect.objectContaining({
            target: 'google_web_search',
          }),
        ]),
        totalGaps: 2,
      }),
    );
  });

  it('installs a registry eval via /evals install', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-31T00:00:00.000Z',
        evals: [
          {
            name: 'shell-safety',
            description: 'Avoid destructive shell usage without confirmation',
            category: 'security',
            evalFile: 'evals/shell-safety.eval.ts',
            ruleFragment: 'Ask before destructive shell commands.',
            author: 'google',
            official: true,
            addedAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
      source: 'network',
      stale: false,
      fetchedAt: '2026-03-31T00:00:00.000Z',
    });

    const installCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'install',
    );
    const result = await installCommand!.action!(context, 'shell-safety');

    expect(managerMock.install).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shell-safety' }),
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Installed 'shell-safety'. Rule active immediately.",
    });
  });

  it('uninstalls an installed eval via /evals uninstall', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    managerMock.readIndex.mockResolvedValue({
      installed: [
        {
          name: 'shell-safety',
          source: 'official',
          installedAt: '2026-03-20T00:00:00.000Z',
          enabled: true,
          ruleFile: '.gemini/eval-rules/shell-safety.rule.md',
          analytics: { runs: 5, passes: 5, passRate: 1 },
        },
      ],
      generated: [],
    });

    const uninstallCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'uninstall',
    );
    const result = await uninstallCommand!.action!(context, 'shell-safety');

    expect(managerMock.uninstall).toHaveBeenCalledWith('shell-safety');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Uninstalled 'shell-safety'.",
    });
  });

  it('offers install completions from the registry', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    managerMock.readIndex.mockResolvedValue({
      installed: [
        {
          name: 'no-edit-on-inspect',
          source: 'official',
          installedAt: '2026-03-20T00:00:00.000Z',
          enabled: true,
          ruleFile: '.gemini/eval-rules/no-edit-on-inspect.rule.md',
          analytics: { runs: 0, passes: 0, passRate: 0 },
        },
      ],
      generated: [],
    });
    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-31T00:00:00.000Z',
        evals: [
          {
            name: 'no-edit-on-inspect',
            description: 'Do not edit files during inspection requests',
            category: 'behavioral',
            evalFile: 'evals/answer-vs-act.eval.ts',
            ruleFragment: 'When asked to inspect, do not edit.',
            author: 'google',
            official: true,
            addedAt: '2026-01-15T00:00:00.000Z',
          },
          {
            name: 'shell-safety',
            description: 'Avoid destructive shell usage without confirmation',
            category: 'security',
            evalFile: 'evals/shell-safety.eval.ts',
            ruleFragment: 'Ask before destructive shell commands.',
            author: 'google',
            official: true,
            addedAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
      source: 'network',
      stale: false,
      fetchedAt: '2026-03-31T00:00:00.000Z',
    });

    const installCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'install',
    );
    const completions = await installCommand!.completion!(context, 'she');

    expect(completions).toEqual(['shell-safety']);
  });

  it('shows stale-cache info when browsing with cached registry data', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    fetchEvalRegistryWithStatusMock.mockResolvedValue({
      registry: {
        version: '1',
        updatedAt: '2026-03-30T00:00:00.000Z',
        evals: [],
      },
      source: 'cache',
      stale: true,
      fetchedAt: '2026-03-30T00:00:00.000Z',
      error: 'network down',
    });

    const browseCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'browse',
    );
    await browseCommand!.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('showing cached marketplace data'),
      }),
    );
  });

  it('shows generated eval details via /evals show', async () => {
    const context = createMockCommandContext({
      services: { config },
    });

    managerMock.readIndex.mockResolvedValue({
      installed: [],
      generated: [
        {
          name: 'download-to-cwd',
          source: 'generated',
          generatedAt: '2026-03-28T00:00:00.000Z',
          enabled: true,
          description: 'Keep downloads in the current directory',
          evalFile: '.gemini/evals/download-to-cwd.eval.ts',
          ruleFile: '.gemini/eval-rules/download-to-cwd.rule.md',
          analytics: { runs: 3, passes: 3, passRate: 1 },
          duplicateCandidates: ['download-files'],
          contributionAssessment: {
            verdict: 'needs-review',
            reasons: [
              'Compare it against existing evals before contributing upstream.',
            ],
          },
        },
      ],
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

    const showCommand = evalsCommand.subCommands?.find(
      (cmd) => cmd.name === 'show',
    );
    await showCommand!.action!(context, 'download-to-cwd');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('contribution fit: needs-review'),
      }),
    );
  });
});
