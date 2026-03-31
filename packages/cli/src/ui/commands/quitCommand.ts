/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatDuration } from '../utils/formatters.js';
import { CommandKind, type SlashCommand } from './types.js';
import { EvalRuleManager } from '@google/gemini-cli-core';
import type { EvalExitSummary } from '../types.js';

export const quitCommand: SlashCommand = {
  name: 'quit',
  altNames: ['exit'],
  description: 'Exit the cli',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const now = Date.now();
    const { sessionStartTime } = context.session.stats;
    const wallDuration = now - sessionStartTime.getTime();

    let evalSummary: EvalExitSummary | undefined;
    try {
      const projectRoot =
        context.services.config?.getProjectRoot() ?? process.cwd();
      const manager = new EvalRuleManager(projectRoot);
      const index = await manager.readIndex();
      const activeRules = [
        ...index.installed
          .filter((e) => e.enabled)
          .map((e) => ({
            name: e.name,
            source: e.source as 'official' | 'community' | 'generated',
          })),
        ...index.generated
          .filter((e) => e.enabled)
          .map((e) => ({
            name: e.name,
            source: 'generated' as const,
            generatedAt: e.generatedAt,
          })),
      ];
      evalSummary = { activeRules };
    } catch {
      /* non-fatal */
    }

    return {
      type: 'quit',
      messages: [
        {
          type: 'user',
          text: `/quit`,
          id: now - 1,
        },
        {
          type: 'quit',
          duration: formatDuration(wallDuration),
          evalSummary,
          id: now,
        },
      ],
    };
  },
};
