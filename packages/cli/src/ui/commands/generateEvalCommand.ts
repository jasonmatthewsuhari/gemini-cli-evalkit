/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import {
  getPendingEvalContext,
  clearPendingEvalContext,
  generateEvalDraft,
  EvalRuleManager,
  type PendingEvalContext,
  type EvalDraft,
} from '@google/gemini-cli-core';
import type { Content } from '@google/genai';

function getManager(context: CommandContext): EvalRuleManager {
  const workspaceRoot =
    context.services.config?.getProjectRoot() ?? process.cwd();
  return new EvalRuleManager(workspaceRoot);
}

function summarizeHistory(history: readonly Content[]): string {
  // Take last 6 turns (3 exchanges) for context
  const recent = history.slice(-6);
  return recent
    .map((turn) => {
      const role = turn.role === 'model' ? 'Agent' : 'User';
      const text = turn.parts
        ?.map((p) => ('text' in p ? p.text : '[tool call]'))
        .join(' ')
        .slice(0, 300);
      return `${role}: ${text}`;
    })
    .join('\n');
}

async function runGenerate(
  context: CommandContext,
  pending: PendingEvalContext,
): Promise<SlashCommandActionReturn | void> {
  const { config } = context.services;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    };
  }

  const contentGenerator = config.getContentGenerator();
  if (!contentGenerator) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Content generator not available.',
    };
  }

  context.ui.addItem({
    type: MessageType.INFO,
    text: 'Generating eval-rule combo...',
  });

  const manager = getManager(context);
  const index = await manager.readIndex();
  const existingNames = [
    ...index.installed.map((e) => e.name),
    ...index.generated.map((e) => e.name),
  ];

  let draft;
  try {
    draft = await generateEvalDraft(
      contentGenerator,
      pending,
      existingNames,
      config.getModel(),
    );
  } catch (err) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to generate eval: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (draft.duplicateOf) {
    clearPendingEvalContext();
    return {
      type: 'message',
      messageType: 'info',
      content: [
        `Already covered by eval '${draft.duplicateOf}'. No new eval generated.`,
        draft.duplicateCandidates && draft.duplicateCandidates.length > 0
          ? `Similar evals: ${draft.duplicateCandidates.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  context.ui.addItem({
    type: MessageType.INFO,
    text: [
      `Name: ${draft.suggestedName}  |  Category: ${draft.category}`,
      renderDraftAssessment(draft),
      '',
      '── Rule (added to GEMINI.md) ──────────────',
      draft.ruleCode,
      '',
      '── Eval (saved to .gemini/evals/) ─────────',
      draft.evalCode.slice(0, 600) +
        (draft.evalCode.length > 600 ? '\n...(truncated)' : ''),
    ].join('\n'),
  });

  try {
    await manager.saveGenerated(
      draft.suggestedName,
      draft.evalCode,
      draft.ruleCode,
      draft.category,
      {
        duplicateCandidates: draft.duplicateCandidates,
        contributionAssessment: draft.contributionAssessment,
      },
    );
  } catch (err) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  clearPendingEvalContext();

  return {
    type: 'message',
    messageType: 'info',
    content: [
      `Saved '${draft.suggestedName}'.`,
      renderDraftAssessment(draft),
      `  .gemini/evals/${draft.suggestedName}.eval.ts`,
      `  .gemini/eval-rules/${draft.suggestedName}.md  →  added to GEMINI.md`,
    ].join('\n'),
  };
}

function renderDraftAssessment(draft: EvalDraft): string {
  const duplicateLine =
    draft.duplicateCandidates && draft.duplicateCandidates.length > 0
      ? `Similar evals to review: ${draft.duplicateCandidates.join(', ')}`
      : 'Similar evals to review: none found';

  const assessment = draft.contributionAssessment;
  if (!assessment) {
    return duplicateLine;
  }

  const verdict =
    assessment.verdict === 'likely-upstream'
      ? 'Contribution fit: likely upstream'
      : assessment.verdict === 'likely-personal'
        ? 'Contribution fit: likely personal/local'
        : 'Contribution fit: review before upstreaming';

  return [
    duplicateLine,
    verdict,
    ...assessment.reasons.map((reason) => `- ${reason}`),
  ].join('\n');
}

export const generateEvalCommand: SlashCommand = {
  name: 'generate-eval',
  description:
    'Generate an eval-rule combo. With no args: manual flow from conversation history. With args: describe the mistake directly.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn | void> => {
    // --- Path 1: auto context from misbehavior detector ---
    const pending = getPendingEvalContext();
    if (pending) {
      return runGenerate(context, pending);
    }

    // --- Path 2: user provided a description as args ---
    const correction = args.trim();
    if (correction) {
      const { config } = context.services;
      const history = config?.getGeminiClient()?.getHistory() ?? [];
      const summary = summarizeHistory(history);

      const manualContext: PendingEvalContext = {
        originalPrompt: summary || '(no conversation history available)',
        agentResponseSummary: '(manually specified)',
        userCorrection: correction,
        detectionDescription: correction,
        relevantFiles: {},
        capturedAt: new Date().toISOString(),
      };
      return runGenerate(context, manualContext);
    }

    // --- Path 3: no context and no args — show summary and prompt ---
    const { config } = context.services;
    const history = config?.getGeminiClient()?.getHistory() ?? [];

    if (history.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: [
          'No conversation history yet.',
          '',
          'Usage: /generate-eval <describe what the agent did wrong>',
          'Example: /generate-eval agent used write_file instead of reading the file first',
        ].join('\n'),
      };
    }

    const summary = summarizeHistory(history);

    context.ui.addItem({
      type: MessageType.INFO,
      text: [
        'Recent conversation:',
        '─────────────────────────────────────────',
        summary,
        '─────────────────────────────────────────',
        '',
        'What should the agent have done instead?',
        'Run: /generate-eval <your correction>',
        '',
        'Example:',
        '  /generate-eval agent should have asked for clarification before running the command',
      ].join('\n'),
    });
  },
};
