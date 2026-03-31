/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { join } from 'node:path';
import type {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  analyzeCoverage,
  EvalRuleManager,
  fetchEvalRegistryWithStatus,
  type CoverageReport,
  type EvalRegistryFetchResult,
  type LocalEvalIndex,
  type RegistryEval,
} from '@google/gemini-cli-core';
import type {
  EvalComboDisplay,
  HistoryItemEvalsCoverage,
  HistoryItemEvalsList,
} from '../types.js';
import { MessageType } from '../types.js';
import { EvalsMarketplaceView } from '../components/views/EvalsMarketplaceView.js';

function getProjectRoot(context: CommandContext): string {
  return context.services.config?.getProjectRoot() ?? process.cwd();
}

function getManager(context: CommandContext): EvalRuleManager {
  return new EvalRuleManager(getProjectRoot(context));
}

async function getCoverageReport(projectRoot: string): Promise<CoverageReport> {
  try {
    return await analyzeCoverage(join(projectRoot, '.gemini', 'evals'));
  } catch {
    return analyzeCoverage(join(projectRoot, 'evals'));
  }
}

async function getRegistryResult(): Promise<EvalRegistryFetchResult> {
  return fetchEvalRegistryWithStatus();
}

async function getRegistryEvals(): Promise<RegistryEval[]> {
  const result = await getRegistryResult();
  return result.registry.evals;
}

function toInstalledCombos(
  index: LocalEvalIndex,
  registryEvals: RegistryEval[],
): EvalComboDisplay[] {
  const registryMeta = new Map(
    registryEvals.map((entry) => [entry.name, entry]),
  );

  const installed = index.installed.map((entry) => {
    const meta = registryMeta.get(entry.name);
    return {
      name: entry.name,
      description: meta?.description,
      category: meta?.category ?? 'installed',
      source: entry.source,
      enabled: entry.enabled,
      passRate: entry.analytics.passRate,
      runs: entry.analytics.runs,
      installed: true,
    } satisfies EvalComboDisplay;
  });

  const generated = index.generated.map((entry) => ({
    name: entry.name,
    description: entry.description ?? entry.name,
    category: 'generated',
    source: 'generated' as const,
    enabled: entry.enabled,
    passRate: entry.analytics.passRate,
    runs: entry.analytics.runs,
    installed: true,
  }));

  return [...installed, ...generated].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function toMarketplaceCombos(
  index: LocalEvalIndex,
  registryEvals: RegistryEval[],
): EvalComboDisplay[] {
  const installed = new Map(
    index.installed.map((entry) => [entry.name, entry]),
  );

  return [...registryEvals]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const local = installed.get(entry.name);
      return {
        name: entry.name,
        description: entry.description,
        category: entry.category,
        source: entry.official ? 'official' : 'community',
        enabled: local?.enabled ?? false,
        passRate: local?.analytics.passRate,
        runs: local?.analytics.runs,
        installed: !!local,
      } satisfies EvalComboDisplay;
    });
}

async function listAction(
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  const manager = getManager(context);
  const [index, registryEvals] = await Promise.all([
    manager.readIndex(),
    getRegistryEvals().catch(() => []),
  ]);

  const item: HistoryItemEvalsList = {
    type: 'evals_list',
    title: 'Installed Eval-Rule Combos',
    view: 'installed',
    combos: toInstalledCombos(index, registryEvals),
  };
  context.ui.addItem(item);
}

async function browseAction(
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  try {
    const manager = getManager(context);
    const [index, registryResult] = await Promise.all([
      manager.readIndex(),
      getRegistryResult(),
    ]);
    const registryEvals = registryResult.registry.evals;

    const item: HistoryItemEvalsList = {
      type: 'evals_list',
      title: 'Eval Marketplace',
      view: 'marketplace',
      combos: toMarketplaceCombos(index, registryEvals),
    };
    if (registryResult.stale) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: `Registry fetch failed; showing cached marketplace data from ${registryResult.fetchedAt ?? 'an earlier session'}. ${registryResult.error ?? ''}`.trim(),
      });
    }
    context.ui.addItem(item);
  } catch (err) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to load eval registry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function coverageAction(
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  const report = await getCoverageReport(getProjectRoot(context));

  const item: HistoryItemEvalsCoverage = {
    type: 'evals_coverage',
    tools: report.tools,
    behavioral: report.behavioral,
    suggestions: report.suggestions,
    totalGaps: report.totalGaps,
  };
  context.ui.addItem(item);
}

async function showAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const name = args.trim();
  if (!name) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /evals show <name>',
    };
  }

  const manager = getManager(context);
  const [index, registryResult] = await Promise.all([
    manager.readIndex(),
    getRegistryResult().catch(() => null),
  ]);

  const installed = index.installed.find((entry) => entry.name === name);
  const generated = index.generated.find((entry) => entry.name === name);
  const registryEntry = registryResult?.registry.evals.find(
    (entry) => entry.name === name,
  );

  if (!installed && !generated && !registryEntry) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Eval '${name}' was not found locally or in the registry.`,
    };
  }

  const lines = [
    `${name}`,
    `status: ${
      generated
        ? generated.enabled
          ? 'generated/enabled'
          : 'generated/disabled'
        : installed
          ? installed.enabled
            ? 'installed/enabled'
            : 'installed/disabled'
          : 'available in marketplace'
    }`,
    `source: ${generated ? 'generated' : registryEntry?.official ? 'official' : registryEntry ? 'community' : (installed?.source ?? 'generated')}`,
    `category: ${registryEntry?.category ?? (generated ? 'generated' : 'installed')}`,
  ];

  if (registryEntry?.description || generated?.description) {
    lines.push(
      `description: ${registryEntry?.description ?? generated?.description}`,
    );
  }
  if (registryEntry) {
    lines.push(`registry eval: ${registryEntry.evalFile}`);
    lines.push(`author: ${registryEntry.author}`);
    lines.push(`added: ${registryEntry.addedAt}`);
    lines.push('');
    lines.push('rule preview:');
    lines.push(registryEntry.ruleFragment);
  }
  if (generated) {
    lines.push('');
    lines.push(`local eval: ${generated.evalFile}`);
    lines.push(`local rule: ${generated.ruleFile}`);
    if (generated.duplicateCandidates?.length) {
      lines.push(`similar evals: ${generated.duplicateCandidates.join(', ')}`);
    }
    if (generated.contributionAssessment) {
      lines.push(
        `contribution fit: ${generated.contributionAssessment.verdict}`,
      );
      lines.push(
        ...generated.contributionAssessment.reasons.map(
          (reason) => `- ${reason}`,
        ),
      );
    }
  }
  if (installed) {
    lines.push('');
    lines.push(`installed at: ${installed.installedAt}`);
    lines.push(
      `analytics: ${Math.round(installed.analytics.passRate * 100)}% (${installed.analytics.runs} runs)`,
    );
  }
  if (generated) {
    lines.push('');
    lines.push(`generated at: ${generated.generatedAt}`);
    lines.push(
      `analytics: ${Math.round(generated.analytics.passRate * 100)}% (${generated.analytics.runs} runs)`,
    );
  }
  if (registryResult?.stale) {
    lines.push('');
    lines.push(
      `registry status: stale cache from ${registryResult.fetchedAt ?? 'an earlier session'}`,
    );
  }

  context.ui.addItem({
    type: MessageType.INFO,
    text: lines.join('\n'),
  });
}

async function installAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const name = args.trim();
  if (!name) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /evals install <name>',
    };
  }

  try {
    const manager = getManager(context);
    const [registryEvals, index] = await Promise.all([
      getRegistryEvals(),
      manager.readIndex(),
    ]);
    const entry = registryEvals.find((evalEntry) => evalEntry.name === name);
    if (!entry) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Eval '${name}' not found in the registry.`,
      };
    }
    if (
      index.installed.some((installedEntry) => installedEntry.name === name)
    ) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Eval '${name}' is already installed.`,
      };
    }

    await manager.install(entry);
    return {
      type: 'message',
      messageType: 'info',
      content: `Installed '${name}'. Rule active immediately.`,
    };
  } catch (err) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function uninstallAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const name = args.trim();
  if (!name) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /evals uninstall <name>',
    };
  }

  try {
    const manager = getManager(context);
    const index = await manager.readIndex();
    if (!index.installed.some((entry) => entry.name === name)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Eval '${name}' is not installed.`,
      };
    }

    await manager.uninstall(name);
    return {
      type: 'message',
      messageType: 'info',
      content: `Uninstalled '${name}'.`,
    };
  } catch (err) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function completeRegistryNames(
  partialArg: string,
  predicate: (name: string, index: LocalEvalIndex) => boolean,
  context: CommandContext,
): Promise<string[]> {
  const manager = getManager(context);
  const [registryEvals, index] = await Promise.all([
    getRegistryEvals(),
    manager.readIndex(),
  ]);

  return registryEvals
    .map((entry) => entry.name)
    .filter((name) => predicate(name, index) && name.startsWith(partialArg));
}

async function completeInstallable(
  context: CommandContext,
  partialArg: string,
) {
  try {
    return await completeRegistryNames(
      partialArg,
      (name, index) => !index.installed.some((entry) => entry.name === name),
      context,
    );
  } catch {
    return [];
  }
}

async function completeInstalled(context: CommandContext, partialArg: string) {
  const index = await getManager(context).readIndex();
  return index.installed
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(partialArg));
}

async function completeDisabled(context: CommandContext, partialArg: string) {
  const index = await getManager(context).readIndex();
  return [...index.installed, ...index.generated]
    .filter((entry) => !entry.enabled)
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(partialArg));
}

async function completeEnabled(context: CommandContext, partialArg: string) {
  const index = await getManager(context).readIndex();
  return [...index.installed, ...index.generated]
    .filter((entry) => entry.enabled)
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(partialArg));
}

async function completeGenerated(context: CommandContext, partialArg: string) {
  const index = await getManager(context).readIndex();
  return index.generated
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(partialArg));
}

// /evals opens the full TUI marketplace
export const evalsCommand: SlashCommand = {
  name: 'evals',
  description: 'Browse, install, inspect coverage, and manage eval-rule combos',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
  ): Promise<SlashCommandActionReturn | void> => {
    const manager = getManager(context);
    const projectRoot = getProjectRoot(context);
    // Lazily resolve the content generator so it's fetched at generate-time,
    // not at command invocation time (when it may not yet be initialized).
    const getContentGenerator = () => {
      try {
        return context.services.config?.getContentGenerator() ?? null;
      } catch {
        return null;
      }
    };
    const getModel = () => context.services.config?.getModel() ?? undefined;
    return {
      type: 'custom_dialog' as const,
      component: React.createElement(EvalsMarketplaceView, {
        manager,
        projectRoot,
        getContentGenerator,
        getModel,
        onClose: () => context.ui.removeComponent(),
      }),
    };
  },

  subCommands: [
    {
      name: 'list',
      description: 'List installed and generated eval-rule combos',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: listAction,
    },
    {
      name: 'browse',
      description: 'List available evals from the marketplace registry',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: browseAction,
    },
    {
      name: 'coverage',
      description: 'Show eval coverage across tools and behavioral patterns',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: coverageAction,
    },
    {
      name: 'show',
      description:
        'Show details for a generated, installed, or marketplace eval',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: showAction,
      completion: async (context, partialArg) => {
        const manager = getManager(context);
        const [index, registryResult] = await Promise.all([
          manager.readIndex(),
          getRegistryResult().catch(() => null),
        ]);
        const names = new Set<string>([
          ...index.installed.map((entry) => entry.name),
          ...index.generated.map((entry) => entry.name),
          ...(registryResult?.registry.evals.map((entry) => entry.name) ?? []),
        ]);
        return [...names].filter((name) => name.startsWith(partialArg)).sort();
      },
    },
    {
      name: 'install',
      description: 'Install an eval-rule combo from the marketplace',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: installAction,
      completion: completeInstallable,
    },
    {
      name: 'uninstall',
      description: 'Uninstall an installed marketplace eval-rule combo',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: uninstallAction,
      completion: completeInstalled,
    },
    {
      name: 'enable',
      description: 'Enable an installed eval-rule combo',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      completion: completeDisabled,
      action: async (
        context,
        args,
      ): Promise<SlashCommandActionReturn | void> => {
        const name = args.trim();
        if (!name) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /evals enable <name>',
          };
        }
        try {
          await getManager(context).setEnabled(name, true);
          return {
            type: 'message',
            messageType: 'info',
            content: `Enabled '${name}'.`,
          };
        } catch (err) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
    {
      name: 'disable',
      description: 'Disable an eval-rule combo',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      completion: completeEnabled,
      action: async (
        context,
        args,
      ): Promise<SlashCommandActionReturn | void> => {
        const name = args.trim();
        if (!name) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /evals disable <name>',
          };
        }
        try {
          await getManager(context).setEnabled(name, false);
          return {
            type: 'message',
            messageType: 'info',
            content: `Disabled '${name}'.`,
          };
        } catch (err) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
    {
      name: 'delete',
      description: 'Delete a generated eval',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      completion: completeGenerated,
      action: async (
        context,
        args,
      ): Promise<SlashCommandActionReturn | void> => {
        const name = args.trim();
        if (!name) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /evals delete <name>',
          };
        }
        try {
          await getManager(context).deleteGenerated(name);
          return {
            type: 'message',
            messageType: 'info',
            content: `Deleted '${name}'.`,
          };
        } catch (err) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ],
};
