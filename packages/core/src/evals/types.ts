/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An eval-rule combo: a paired behavioral eval + GEMINI.md rule fragment.
 * The eval validates that the rule is actually followed.
 */
export interface EvalRuleCombo {
  /** Unique identifier, e.g. "no-edit-on-inspect" */
  name: string;
  /** Human-readable description */
  description: string;
  /** Behavioral category */
  category: EvalCategory;
  /** Whether this came from the official registry, was generated locally, or contributed */
  source: 'official' | 'generated' | 'community';
  /** Whether this combo is currently active */
  enabled: boolean;
  /** ISO date string */
  createdAt: string;
  /** Path to the eval file (relative to repo root for official, absolute for generated) */
  evalFile: string;
  /** Path to the rule fragment file */
  ruleFile: string;
  /** Local analytics data */
  analytics: EvalAnalytics;
}

export type EvalCategory =
  | 'behavioral'
  | 'security'
  | 'efficiency'
  | 'architecture'
  | 'memory'
  | 'subagent';

export interface EvalAnalytics {
  /** Number of agent turns this eval's assertion has been checked */
  runs: number;
  /** Number of passing checks */
  passes: number;
  /** Pass rate 0-1 */
  passRate: number;
  /** Timestamp of last run */
  lastRunAt?: string;
}

/**
 * An entry in the official eval registry (eval-registry.json in the upstream repo).
 */
export interface RegistryEval {
  name: string;
  description: string;
  category: EvalCategory;
  /** Relative path to the eval file in the upstream repo */
  evalFile: string;
  /** The GEMINI.md rule text to install */
  ruleFragment: string;
  author: string;
  official: boolean;
  addedAt: string;
}

/**
 * The full eval-registry.json structure.
 */
export interface EvalRegistry {
  version: string;
  updatedAt: string;
  evals: RegistryEval[];
}

export interface EvalRegistryFetchResult {
  registry: EvalRegistry;
  source: 'network' | 'cache';
  stale: boolean;
  fetchedAt?: string;
  error?: string;
}

/**
 * The local index of installed + generated eval-rule combos (.gemini/eval-rules/index.json).
 */
export interface LocalEvalIndex {
  installed: InstalledEvalEntry[];
  generated: GeneratedEvalEntry[];
}

export interface InstalledEvalEntry {
  name: string;
  source: 'official' | 'community';
  installedAt: string;
  enabled: boolean;
  ruleFile: string;
  analytics: EvalAnalytics;
}

export interface GeneratedEvalEntry {
  name: string;
  source: 'generated';
  generatedAt: string;
  enabled: boolean;
  description?: string;
  evalFile: string;
  ruleFile: string;
  analytics: EvalAnalytics;
  duplicateCandidates?: string[];
  contributionAssessment?: EvalContributionAssessment;
}

/**
 * Result from the misbehavior detector.
 */
export interface DetectionResult {
  detected: boolean;
  confidence: number;
  /** One-sentence description of what the agent did wrong */
  description: string;
  /** The specific behavior that was incorrect */
  behavior: string;
}

/**
 * Context captured at detection time, passed to the generator.
 */
export interface PendingEvalContext {
  /** The user's original request */
  originalPrompt: string;
  /** Summary of the agent's response (tool calls + text) */
  agentResponseSummary: string;
  /** The user's correction message */
  userCorrection: string;
  /** Description from the detector */
  detectionDescription: string;
  /** Files that were read or modified during the turn */
  relevantFiles: Record<string, string>;
  /** Timestamp */
  capturedAt: string;
}

/**
 * A generated eval draft ready for user review.
 */
export interface EvalDraft {
  /** The generated eval TypeScript code */
  evalCode: string;
  /** The generated rule markdown fragment */
  ruleCode: string;
  /** Suggested name for the combo */
  suggestedName: string;
  /** Detected category */
  category: EvalCategory;
  /** Whether a similar eval already exists */
  duplicateOf?: string;
  /** Similar eval names worth reviewing before contributing upstream */
  duplicateCandidates?: string[];
  /** Heuristic assessment of whether the eval looks upstream-worthy */
  contributionAssessment?: EvalContributionAssessment;
}

export interface EvalContributionAssessment {
  verdict: 'likely-upstream' | 'needs-review' | 'likely-personal';
  reasons: string[];
}

/**
 * Coverage report from the static analyzer.
 */
export interface CoverageReport {
  tools: ToolCoverageEntry[];
  behavioral: BehavioralCoverageEntry[];
  suggestions: CoverageSuggestion[];
  totalGaps: number;
  generatedAt: string;
}

export interface CoverageSuggestion {
  kind: 'tool' | 'behavior';
  target: string;
  category: string;
  prompt: string;
  rationale: string;
  upstreamPotential: 'high' | 'medium';
}

export interface ToolCoverageEntry {
  name: string;
  evalCount: number;
  evalNames: string[];
  isGap: boolean;
  suggestion?: CoverageSuggestion;
}

export interface BehavioralCoverageEntry {
  category: string;
  evalCount: number;
  evalNames: string[];
  isGap: boolean;
  suggestion?: CoverageSuggestion;
}
