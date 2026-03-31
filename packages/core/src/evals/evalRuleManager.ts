/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  LocalEvalIndex,
  InstalledEvalEntry,
  GeneratedEvalEntry,
  EvalAnalytics,
  RegistryEval,
  EvalContributionAssessment,
} from './types.js';

const EMPTY_ANALYTICS: EvalAnalytics = {
  runs: 0,
  passes: 0,
  passRate: 0,
};

const EMPTY_INDEX: LocalEvalIndex = {
  installed: [],
  generated: [],
};

/**
 * Manages the local eval-rule state under .gemini/eval-rules/.
 */
export class EvalRuleManager {
  private readonly evalRulesDir: string;
  private readonly evalsDir: string;
  private readonly indexPath: string;
  private readonly geminiMdPath: string;

  constructor(projectRoot: string) {
    this.evalRulesDir = path.join(projectRoot, '.gemini', 'eval-rules');
    this.evalsDir = path.join(projectRoot, '.gemini', 'evals');
    this.indexPath = path.join(this.evalRulesDir, 'index.json');
    this.geminiMdPath = path.join(projectRoot, '.gemini', 'GEMINI.md');
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.evalRulesDir, { recursive: true });
    await fs.mkdir(this.evalsDir, { recursive: true });
  }

  async readIndex(): Promise<LocalEvalIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      return parseLocalEvalIndex(JSON.parse(raw));
    } catch {
      return { ...EMPTY_INDEX, installed: [], generated: [] };
    }
  }

  async writeIndex(index: LocalEvalIndex): Promise<void> {
    await this.ensureDirs();
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  async install(registryEval: RegistryEval): Promise<void> {
    await this.ensureDirs();
    const index = await this.readIndex();

    const existingIdx = index.installed.findIndex(
      (e) => e.name === registryEval.name,
    );
    if (existingIdx >= 0) {
      // Re-enable if disabled
      const updated = { ...index.installed[existingIdx], enabled: true };
      index.installed[existingIdx] = updated;
      await this.writeIndex(index);
      await this.updateGeminiMd(
        registryEval.name,
        registryEval.ruleFragment,
        true,
      );
      return;
    }

    const ruleFile = path.join(
      this.evalRulesDir,
      `${registryEval.name}.rule.md`,
    );
    const ruleContent = this.buildRuleFile(
      registryEval.name,
      registryEval.ruleFragment,
      'official',
    );
    await fs.writeFile(ruleFile, ruleContent, 'utf-8');

    const entry: InstalledEvalEntry = {
      name: registryEval.name,
      source: registryEval.official ? 'official' : 'community',
      installedAt: new Date().toISOString(),
      enabled: true,
      ruleFile,
      analytics: { ...EMPTY_ANALYTICS },
    };

    index.installed = [...index.installed, entry];
    await this.writeIndex(index);
    await this.updateGeminiMd(
      registryEval.name,
      registryEval.ruleFragment,
      true,
    );
  }

  async uninstall(name: string): Promise<void> {
    const index = await this.readIndex();
    const entry = index.installed.find((e) => e.name === name);
    if (!entry) return;

    try {
      await fs.unlink(entry.ruleFile);
    } catch {
      // File may already be gone
    }

    await this.updateGeminiMd(name, '', false);
    index.installed = index.installed.filter((e) => e.name !== name);
    await this.writeIndex(index);
  }

  async saveGenerated(
    name: string,
    evalCode: string,
    ruleFragment: string,
    category: string,
    metadata?: {
      duplicateCandidates?: string[];
      contributionAssessment?: EvalContributionAssessment;
    },
  ): Promise<GeneratedEvalEntry> {
    await this.ensureDirs();

    const evalFile = path.join(this.evalsDir, `${name}.eval.ts`);
    const ruleFile = path.join(this.evalRulesDir, `${name}.rule.md`);

    await fs.writeFile(evalFile, evalCode, 'utf-8');
    await fs.writeFile(
      ruleFile,
      this.buildRuleFile(name, ruleFragment, 'generated'),
      'utf-8',
    );

    // Extract first meaningful line of the rule as a short description
    const description =
      ruleFragment
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#')) ?? name;

    const entry: GeneratedEvalEntry = {
      name,
      source: 'generated',
      generatedAt: new Date().toISOString(),
      enabled: true,
      description,
      evalFile,
      ruleFile,
      analytics: { ...EMPTY_ANALYTICS },
      duplicateCandidates: metadata?.duplicateCandidates,
      contributionAssessment: metadata?.contributionAssessment,
    };

    const index = await this.readIndex();
    index.generated = [
      ...index.generated.filter((e) => e.name !== name),
      entry,
    ];
    await this.writeIndex(index);
    await this.updateGeminiMd(name, ruleFragment, true);

    return entry;
  }

  async deleteGenerated(name: string): Promise<void> {
    const index = await this.readIndex();
    const entry = index.generated.find((e) => e.name === name);
    if (!entry) return;

    try {
      await fs.unlink(entry.evalFile);
    } catch {
      // ignore
    }
    try {
      await fs.unlink(entry.ruleFile);
    } catch {
      // ignore
    }

    await this.updateGeminiMd(name, '', false);
    index.generated = index.generated.filter((e) => e.name !== name);
    await this.writeIndex(index);
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const index = await this.readIndex();

    let ruleFragment: string | null = null;

    const installedIdx = index.installed.findIndex((e) => e.name === name);
    if (installedIdx >= 0) {
      index.installed[installedIdx] = {
        ...index.installed[installedIdx],
        enabled,
      };
      try {
        const ruleContent = await fs.readFile(
          index.installed[installedIdx].ruleFile,
          'utf-8',
        );
        ruleFragment = this.extractRuleText(ruleContent);
      } catch {
        // ignore
      }
    }

    const generatedIdx = index.generated.findIndex((e) => e.name === name);
    if (generatedIdx >= 0) {
      index.generated[generatedIdx] = {
        ...index.generated[generatedIdx],
        enabled,
      };
      try {
        const ruleContent = await fs.readFile(
          index.generated[generatedIdx].ruleFile,
          'utf-8',
        );
        ruleFragment = this.extractRuleText(ruleContent);
      } catch {
        // ignore
      }
    }

    await this.writeIndex(index);
    if (ruleFragment !== null) {
      await this.updateGeminiMd(name, ruleFragment, enabled);
    }
  }

  async recordAnalytics(name: string, passed: boolean): Promise<void> {
    const index = await this.readIndex();

    const updateAnalytics = (analytics: EvalAnalytics): EvalAnalytics => {
      const newRuns = analytics.runs + 1;
      const newPasses = analytics.passes + (passed ? 1 : 0);
      return {
        runs: newRuns,
        passes: newPasses,
        passRate: newPasses / newRuns,
        lastRunAt: new Date().toISOString(),
      };
    };

    const installedIdx = index.installed.findIndex((e) => e.name === name);
    if (installedIdx >= 0) {
      index.installed[installedIdx] = {
        ...index.installed[installedIdx],
        analytics: updateAnalytics(index.installed[installedIdx].analytics),
      };
    }

    const generatedIdx = index.generated.findIndex((e) => e.name === name);
    if (generatedIdx >= 0) {
      index.generated[generatedIdx] = {
        ...index.generated[generatedIdx],
        analytics: updateAnalytics(index.generated[generatedIdx].analytics),
      };
    }

    await this.writeIndex(index);
  }

  private buildRuleFile(
    name: string,
    ruleFragment: string,
    source: string,
  ): string {
    return [
      `---`,
      `eval: ${name}`,
      `generated: ${new Date().toISOString()}`,
      `source: ${source}`,
      `---`,
      ``,
      ruleFragment,
    ].join('\n');
  }

  private extractRuleText(ruleFileContent: string): string {
    // Strip frontmatter
    const match = ruleFileContent.match(/^---[\s\S]*?---\n([\s\S]*)$/);
    return match ? match[1].trim() : ruleFileContent.trim();
  }

  /**
   * Adds or removes a rule fragment from .gemini/GEMINI.md.
   * Rules are written under a sentinel section so we can find and remove them.
   */
  private async updateGeminiMd(
    name: string,
    ruleFragment: string,
    add: boolean,
  ): Promise<void> {
    let content = '';
    try {
      content = await fs.readFile(this.geminiMdPath, 'utf-8');
    } catch {
      // File doesn't exist yet — will be created
    }

    const startMarker = `<!-- eval-rule:${name}:start -->`;
    const endMarker = `<!-- eval-rule:${name}:end -->`;

    // Remove existing block for this rule (if any)
    const blockRegex = new RegExp(
      `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}\n?`,
      'g',
    );
    content = content.replace(blockRegex, '');

    if (add && ruleFragment.trim()) {
      const sectionHeader = `\n## Agent Rules (Generated)\n\n`;
      const block = `${startMarker}\n${ruleFragment.trim()}\n${endMarker}\n`;

      if (content.includes('## Agent Rules (Generated)')) {
        // Insert block right after the section header line
        content = content.replace(
          /(## Agent Rules \(Generated\)\n)/,
          `$1\n${block}`,
        );
      } else {
        content = content.trimEnd() + `\n${sectionHeader}${block}`;
      }
    }

    // Ensure .gemini directory exists
    await fs.mkdir(path.dirname(this.geminiMdPath), { recursive: true });
    await fs.writeFile(this.geminiMdPath, content.trim() + '\n', 'utf-8');
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLocalEvalIndex(value: unknown): LocalEvalIndex {
  if (
    typeof value === 'object' &&
    value !== null &&
    'installed' in value &&
    'generated' in value &&
    Array.isArray(value.installed) &&
    Array.isArray(value.generated)
  ) {
    return value;
  }

  throw new Error('Invalid local eval index payload.');
}
