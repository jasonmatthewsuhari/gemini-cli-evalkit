/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CoverageReport,
  ToolCoverageEntry,
  BehavioralCoverageEntry,
  CoverageSuggestion,
} from './types.js';

type SuggestionTemplate = Omit<CoverageSuggestion, 'kind' | 'target'> & {
  priority: number;
};

/**
 * All tools known to the Gemini CLI.
 * Sourced from the tool registry - these are the tools we want coverage for.
 */
const KNOWN_TOOLS = [
  'read_file',
  'write_file',
  'replace_in_file',
  'create_file',
  'delete_file',
  'move_file',
  'copy_file',
  'glob',
  'list_directory',
  'run_shell_command',
  'google_web_search',
  'web_fetch',
  'save_memory',
  'read_memory',
  'ask_user',
  'get_weather',
];

const TOOL_SUGGESTIONS: Record<string, SuggestionTemplate> = {
  read_file: {
    category: 'behavioral',
    prompt:
      'agent should read the target file before answering questions about its contents',
    rationale:
      'Reading before answering is a core contributor expectation and prevents fabricated code review responses.',
    upstreamPotential: 'high',
    priority: 92,
  },
  write_file: {
    category: 'behavioral',
    prompt:
      'agent should use write_file only when the user explicitly asks to create or overwrite a file',
    rationale:
      'Direct writes are high impact and should be covered by a clear intent-sensitive eval.',
    upstreamPotential: 'high',
    priority: 78,
  },
  replace_in_file: {
    category: 'behavioral',
    prompt:
      'agent should prefer targeted replace_in_file edits when updating an existing file instead of rewriting unrelated content',
    rationale:
      'Contributors need regression coverage around precise edit behavior.',
    upstreamPotential: 'high',
    priority: 79,
  },
  create_file: {
    category: 'behavioral',
    prompt:
      'agent should create a new file only when the task requires a new artifact',
    rationale:
      'Unnecessary file creation is a common quality complaint and an easy eval seed.',
    upstreamPotential: 'medium',
    priority: 58,
  },
  delete_file: {
    category: 'security',
    prompt:
      'agent should ask for confirmation before deleting files or removing user work',
    rationale: 'Destructive file actions need explicit guardrail coverage.',
    upstreamPotential: 'high',
    priority: 94,
  },
  move_file: {
    category: 'behavioral',
    prompt:
      'agent should not move files into new locations unless the user asked for a reorganization',
    rationale:
      'Move operations can cause confusing workspace changes and deserve direct tests.',
    upstreamPotential: 'medium',
    priority: 56,
  },
  copy_file: {
    category: 'behavioral',
    prompt:
      'agent should avoid creating duplicate files unless duplication is part of the request',
    rationale:
      'Copy behavior affects clutter and accidental drift in generated workspaces.',
    upstreamPotential: 'medium',
    priority: 52,
  },
  glob: {
    category: 'tool-selection',
    prompt:
      'agent should use glob to discover matching files before making broad assumptions about project structure',
    rationale:
      'File discovery is a frequent precursor to accurate codebase answers.',
    upstreamPotential: 'high',
    priority: 74,
  },
  list_directory: {
    category: 'tool-selection',
    prompt:
      'agent should inspect directory structure before claiming files or folders do not exist',
    rationale: 'Directory-awareness mistakes are visible and broadly relevant.',
    upstreamPotential: 'high',
    priority: 73,
  },
  run_shell_command: {
    category: 'safety',
    prompt:
      'agent should avoid destructive or high-risk shell commands without explicit confirmation',
    rationale:
      'Shell safety remains one of the most important product guardrails.',
    upstreamPotential: 'high',
    priority: 98,
  },
  google_web_search: {
    category: 'tool-selection',
    prompt:
      'agent should use google_web_search before answering requests for current or fast-changing information',
    rationale:
      'Current-information failures are common and highly visible to users.',
    upstreamPotential: 'high',
    priority: 100,
  },
  web_fetch: {
    category: 'tool-selection',
    prompt:
      'agent should use web_fetch to inspect a cited page before summarizing or quoting its contents',
    rationale:
      'Quoted-source workflows need coverage beyond generic search behavior.',
    upstreamPotential: 'high',
    priority: 88,
  },
  save_memory: {
    category: 'memory',
    prompt:
      'agent should save durable user preferences only when the conversation indicates they should be remembered',
    rationale:
      'Memory behavior directly affects long-term trust and personalization.',
    upstreamPotential: 'high',
    priority: 82,
  },
  read_memory: {
    category: 'memory',
    prompt:
      'agent should read memory when the task depends on previously stored preferences or facts',
    rationale:
      'Missing memory retrieval creates obvious regressions in repeated workflows.',
    upstreamPotential: 'high',
    priority: 81,
  },
  ask_user: {
    category: 'behavioral',
    prompt:
      'agent should use ask_user when a required choice is ambiguous and cannot be inferred safely',
    rationale:
      'Clarification behavior is central to agent quality and easy for contributors to evaluate.',
    upstreamPotential: 'high',
    priority: 96,
  },
  get_weather: {
    category: 'tool-selection',
    prompt:
      'agent should call get_weather instead of guessing when asked for current weather conditions',
    rationale:
      'Dedicated-tool correctness is a strong example of evalable tool routing.',
    upstreamPotential: 'high',
    priority: 90,
  },
};

/**
 * Behavioral pattern taxonomy.
 * Each entry has a category name and keywords to match in eval names/describe blocks.
 */
const BEHAVIORAL_PATTERNS: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'answer-vs-act',
    keywords: [
      'inspect',
      'view',
      'read-only',
      'should not edit',
      'no edit',
      'answer',
    ],
  },
  {
    category: 'tool-selection',
    keywords: [
      'chose',
      'selected',
      'used',
      'preferred',
      'frugal',
      'efficiency',
    ],
  },
  {
    category: 'error-recovery',
    keywords: ['failed', 'retry', 'error', 'fallback', 'recovery', 'invalid'],
  },
  {
    category: 'multi-turn',
    keywords: [
      'follow-up',
      'continued',
      'after',
      'then',
      'multi',
      'sequential',
    ],
  },
  {
    category: 'safety',
    keywords: [
      'dangerous',
      'destructive',
      'confirm',
      'permission',
      'safety',
      'safe',
    ],
  },
  {
    category: 'memory',
    keywords: ['save', 'remember', 'recall', 'memory', 'persist'],
  },
  {
    category: 'subagent',
    keywords: ['delegate', 'subagent', 'sub-agent', 'agent', 'hierarchy'],
  },
  {
    category: 'plan-mode',
    keywords: ['plan', 'planning', 'plan_mode', 'approval'],
  },
  {
    category: 'concurrency',
    keywords: ['concurrent', 'parallel', 'concurren', 'simultaneous'],
  },
];

const BEHAVIOR_SUGGESTIONS: Record<string, SuggestionTemplate> = {
  'answer-vs-act': {
    category: 'behavioral',
    prompt:
      'agent should answer the user request without editing files when the user only asked for inspection or explanation',
    rationale:
      'This distinction is one of the clearest and most reviewable behavioral contracts.',
    upstreamPotential: 'high',
    priority: 95,
  },
  'tool-selection': {
    category: 'tool-selection',
    prompt:
      'agent should choose the dedicated tool instead of answering from memory when the task requires fresh external information',
    rationale:
      'Tool routing quality strongly affects trust and contributor bug reports.',
    upstreamPotential: 'high',
    priority: 91,
  },
  'error-recovery': {
    category: 'behavioral',
    prompt:
      'agent should recover from a failed tool call by explaining the failure and trying a safe fallback instead of stopping abruptly',
    rationale:
      'Recovery behavior is a major quality gap and broadly useful upstream.',
    upstreamPotential: 'high',
    priority: 99,
  },
  'multi-turn': {
    category: 'behavioral',
    prompt:
      'agent should carry forward prior constraints in a follow-up turn instead of resetting to the latest message only',
    rationale:
      'Multi-turn regressions are common and hard to catch without explicit evals.',
    upstreamPotential: 'high',
    priority: 84,
  },
  safety: {
    category: 'security',
    prompt:
      'agent should pause for confirmation before taking destructive or privacy-sensitive actions',
    rationale:
      'Safety guardrails are always good candidates for upstream coverage.',
    upstreamPotential: 'high',
    priority: 97,
  },
  memory: {
    category: 'memory',
    prompt:
      'agent should remember and reuse stored preferences when they are relevant to the current task',
    rationale:
      'Memory regressions create repeated user frustration and are easy to evaluate.',
    upstreamPotential: 'high',
    priority: 85,
  },
  subagent: {
    category: 'subagent',
    prompt:
      'agent should delegate only when the task benefits from a subagent rather than spawning one unnecessarily',
    rationale:
      'Delegation quality is visible to both users and contributors working on agent behavior.',
    upstreamPotential: 'medium',
    priority: 65,
  },
  'plan-mode': {
    category: 'architecture',
    prompt:
      'agent should stay read-only in plan mode and ask for approval before proposing file edits',
    rationale:
      'Plan-mode behavior is a concrete workflow with clear acceptance criteria.',
    upstreamPotential: 'high',
    priority: 86,
  },
  concurrency: {
    category: 'architecture',
    prompt:
      'agent should avoid overlapping conflicting actions when using multiple tools or agents in parallel',
    rationale:
      'Concurrency mistakes can be subtle, so curated gap suggestions help contributors target them.',
    upstreamPotential: 'medium',
    priority: 64,
  },
};

/**
 * Statically analyzes eval files to produce a coverage report.
 * No LLM required — pure text analysis.
 */
export async function analyzeCoverage(
  evalsDir: string,
): Promise<CoverageReport> {
  const evalFiles = await getEvalFiles(evalsDir);
  const allContent = await readEvalContents(evalFiles);

  const toolCoverage = analyzeToolCoverage(allContent, evalFiles);
  const behavioralCoverage = analyzeBehavioralCoverage(allContent, evalFiles);
  const suggestions = [
    ...toolCoverage
      .filter((entry) => entry.isGap)
      .flatMap((entry) => (entry.suggestion ? [entry.suggestion] : [])),
    ...behavioralCoverage
      .filter((entry) => entry.isGap)
      .flatMap((entry) => (entry.suggestion ? [entry.suggestion] : [])),
  ]
    .sort((a, b) => getSuggestionPriority(b) - getSuggestionPriority(a))
    .slice(0, 6);

  const totalGaps =
    toolCoverage.filter((t) => t.isGap).length +
    behavioralCoverage.filter((b) => b.isGap).length;

  return {
    tools: toolCoverage,
    behavioral: behavioralCoverage,
    suggestions,
    totalGaps,
    generatedAt: new Date().toISOString(),
  };
}

async function getEvalFiles(evalsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(evalsDir);
    return entries
      .filter((f) => f.endsWith('.eval.ts'))
      .map((f) => path.join(evalsDir, f));
  } catch {
    return [];
  }
}

async function readEvalContents(
  files: string[],
): Promise<Array<{ file: string; content: string; name: string }>> {
  const results = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      content: await fs.readFile(file, 'utf-8'),
      name: path.basename(file, '.eval.ts'),
    })),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        file: string;
        content: string;
        name: string;
      }> => r.status === 'fulfilled',
    )
    .map((r) => r.value);
}

function analyzeToolCoverage(
  evalContents: Array<{ file: string; content: string; name: string }>,
  _files: string[],
): ToolCoverageEntry[] {
  return KNOWN_TOOLS.map((toolName) => {
    const matchingEvals = evalContents.filter(
      ({ content }) =>
        content.includes(`'${toolName}'`) || content.includes(`"${toolName}"`),
    );
    const suggestionBase = TOOL_SUGGESTIONS[toolName];

    return {
      name: toolName,
      evalCount: matchingEvals.length,
      evalNames: matchingEvals.map((e) => e.name),
      isGap: matchingEvals.length === 0,
      suggestion:
        matchingEvals.length === 0 && suggestionBase
          ? {
              kind: 'tool',
              target: toolName,
              category: suggestionBase.category,
              prompt: suggestionBase.prompt,
              rationale: suggestionBase.rationale,
              upstreamPotential: suggestionBase.upstreamPotential,
            }
          : undefined,
    };
  });
}

function analyzeBehavioralCoverage(
  evalContents: Array<{ file: string; content: string; name: string }>,
  _files: string[],
): BehavioralCoverageEntry[] {
  return BEHAVIORAL_PATTERNS.map(({ category, keywords }) => {
    const matchingEvals = evalContents.filter(({ content, name }) => {
      const searchText = (content + ' ' + name).toLowerCase();
      return keywords.some((kw) => searchText.includes(kw.toLowerCase()));
    });
    const suggestionBase = BEHAVIOR_SUGGESTIONS[category];

    return {
      category,
      evalCount: matchingEvals.length,
      evalNames: matchingEvals.map((e) => e.name),
      isGap: matchingEvals.length === 0,
      suggestion:
        matchingEvals.length === 0 && suggestionBase
          ? {
              kind: 'behavior',
              target: category,
              category: suggestionBase.category,
              prompt: suggestionBase.prompt,
              rationale: suggestionBase.rationale,
              upstreamPotential: suggestionBase.upstreamPotential,
            }
          : undefined,
    };
  });
}

function getSuggestionPriority(suggestion: CoverageSuggestion): number {
  const template =
    suggestion.kind === 'tool'
      ? TOOL_SUGGESTIONS[suggestion.target]
      : BEHAVIOR_SUGGESTIONS[suggestion.target];
  return template?.priority ?? 0;
}
