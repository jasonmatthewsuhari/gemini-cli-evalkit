/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.js';
import { LlmRole } from '../telemetry/llmRole.js';
import type {
  PendingEvalContext,
  EvalDraft,
  EvalCategory,
  EvalContributionAssessment,
} from './types.js';

/**
 * Generates a paired eval + GEMINI.md rule from a PendingEvalContext.
 */
export async function generateEvalDraft(
  contentGenerator: ContentGenerator,
  context: PendingEvalContext,
  existingEvalNames: string[],
  model?: string,
): Promise<EvalDraft> {
  const prompt = buildGenerationPrompt(context, existingEvalNames);

  const response = await contentGenerator.generateContent(
    {
      model: model ?? 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    },
    'eval-generation',
    LlmRole.UTILITY_TOOL,
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = parseGenerationResponse(text);

  if (!parsed) {
    throw new Error('Failed to parse eval generation response from model.');
  }

  const name = sanitizeName(parsed.name ?? 'generated-eval');
  const category = validateCategory(parsed.category) ?? 'behavioral';
  const assertionType = parsed.assertionType ?? 'tool_absent';

  const evalCode = buildEvalCode(
    name,
    parsed.prompt ?? context.originalPrompt,
    parsed.files ?? {},
    assertionType,
    parsed.assertionDetail ?? '',
    parsed.assertionComment,
  );

  const ruleCode = buildRuleCode(
    parsed.ruleCategory ?? 'Agent Behavior',
    parsed.ruleText ?? context.detectionDescription,
  );

  const duplicateCandidates = findDuplicateCandidates(existingEvalNames, name);
  const duplicateOf = duplicateCandidates.find((candidate) =>
    isStrongDuplicate(candidate, name),
  );
  const contributionAssessment = assessContributionFit(
    parsed.prompt ?? context.originalPrompt,
    parsed.ruleText ?? context.detectionDescription,
    context.userCorrection,
  );

  return {
    evalCode,
    ruleCode,
    suggestedName: name,
    category,
    duplicateOf,
    duplicateCandidates,
    contributionAssessment,
  };
}

interface GenerationResponse {
  name: string;
  category: string;
  prompt: string;
  files: Record<string, string>;
  assertionType:
    | 'tool_absent'
    | 'tool_present'
    | 'file_content'
    | 'file_absent'
    | 'output_matches';
  assertionDetail: string;
  assertionComment?: string;
  ruleCategory: string;
  ruleText: string;
}

function buildGenerationPrompt(
  context: PendingEvalContext,
  existingEvalNames: string[],
): string {
  return `You are generating a behavioral eval test for the Gemini CLI agent.

A user corrected the agent:
- Original request: "${context.originalPrompt}"
- Agent behavior: "${context.agentResponseSummary.slice(0, 1000)}"
- User correction: "${context.userCorrection}"
- What went wrong: "${context.detectionDescription}"

Relevant files in the workspace at time of failure:
${JSON.stringify(context.relevantFiles, null, 2).slice(0, 2000)}

Existing eval names (avoid duplicates): ${existingEvalNames.join(', ')}

Generate a minimal, reproducible eval test. Return JSON only:
{
  "name": "kebab-case-name-for-this-eval",
  "category": "behavioral" | "security" | "efficiency" | "architecture" | "memory" | "subagent",
  "prompt": "minimal user prompt that triggers the bad behavior",
  "files": { "filename.ext": "file content needed to reproduce the issue" },
  "assertionType": "tool_absent" | "tool_present" | "file_content" | "file_absent" | "output_matches",
  "assertionDetail": "the tool name, file path, content string, or output pattern to assert",
  "assertionComment": "optional: add this comment if the assertion is approximate",
  "ruleCategory": "Short Category Name",
  "ruleText": "The GEMINI.md rule text in positive framing (do X, not don't do X)"
}

Rules:
- Keep files minimal: 1-2 files max, under 5 lines each
- The prompt should be clear and unambiguous
- Prefer tool_absent or file_absent assertions (most reliable)
- assertionDetail for tool_absent: the tool name (e.g. "run_shell_command")
- assertionDetail for file_absent: the path that should NOT exist (e.g. "cat_pictures/")
- assertionDetail for file_content: "path::expectedContent" (e.g. "app.ts::a + b")
- assertionDetail for output_matches: a regex pattern
- ruleText should use positive framing: "do X" not "don't do X"`;
}

function buildEvalCode(
  name: string,
  prompt: string,
  files: Record<string, string>,
  assertionType: string,
  assertionDetail: string,
  assertionComment?: string,
): string {
  const filesStr = JSON.stringify(files, null, 2);
  const assertion = buildAssertion(
    assertionType,
    assertionDetail,
    assertionComment,
  );
  const describeName = name.replace(/-/g, '_');

  return `/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Auto-generated by /generate-eval — review before contributing upstream

import { describe, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { evalTest } from './test-helper.js';

describe('${describeName}', () => {
  evalTest('USUALLY_PASSES', {
    name: '${name}',
    prompt: ${JSON.stringify(prompt)},
    files: ${filesStr},
    assert: async (rig) => {
      ${assertion}
    },
  });
});
`;
}

function buildAssertion(
  assertionType: string,
  assertionDetail: string,
  comment?: string,
): string {
  const commentLine = comment ? `// ${comment}\n      ` : '';

  switch (assertionType) {
    case 'tool_absent': {
      const toolName = assertionDetail;
      return `${commentLine}const toolLogs = rig.readToolLogs();
      const calls = toolLogs.filter((log) => log.toolRequest.name === '${toolName}');
      expect(calls.length).toBe(0);`;
    }
    case 'tool_present': {
      const toolName = assertionDetail;
      return `${commentLine}const toolLogs = rig.readToolLogs();
      const calls = toolLogs.filter(
        (log) => log.toolRequest.name === '${toolName}' && log.toolRequest.success,
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);`;
    }
    case 'file_absent': {
      const filePath = assertionDetail;
      return `${commentLine}const testDir = rig.getTestDir();
      const targetPath = path.join(testDir, '${filePath}');
      expect(fs.existsSync(targetPath), '${filePath} should not exist').toBe(false);`;
    }
    case 'file_content': {
      const [filePath, expected] = assertionDetail.split('::');
      return `${commentLine}const content = rig.readFile('${filePath}');
      expect(content).toContain(${JSON.stringify(expected ?? '')});`;
    }
    case 'output_matches': {
      const pattern = assertionDetail;
      return `${commentLine}const output = rig.getStaticOutput();
      expect(output).toMatch(/${pattern}/i);`;
    }
    default: {
      return `${commentLine}// TODO: Manual assertion needed — assertionType not recognized
      const toolLogs = rig.readToolLogs();
      expect(toolLogs.length).toBeGreaterThan(0);`;
    }
  }
}

function buildRuleCode(ruleCategory: string, ruleText: string): string {
  return `## ${ruleCategory}
${ruleText}`;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function validateCategory(cat: unknown): EvalCategory | null {
  const valid = new Set<EvalCategory>([
    'behavioral',
    'security',
    'efficiency',
    'architecture',
    'memory',
    'subagent',
  ]);
  return typeof cat === 'string' && valid.has(cat) ? cat : null;
}

function areSimilar(a: string, b: string): boolean {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  const overlap = [...aTokens].filter((token) => bTokens.has(token));

  if (a === b) return true;
  if (overlap.length >= 2) return true;

  // Fallback to shared prefix of 4+ chars for very similar kebab names.
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) shared++;
    else break;
  }
  return shared >= 4;
}

function findDuplicateCandidates(
  existingEvalNames: string[],
  name: string,
): string[] {
  return existingEvalNames
    .filter((existing) => areSimilar(existing, name))
    .slice(0, 3);
}

function isStrongDuplicate(existing: string, next: string): boolean {
  if (existing === next) return true;

  const existingTokens = tokenize(existing);
  const nextTokens = tokenize(next);

  if (
    existingTokens.size > 0 &&
    existingTokens.size === nextTokens.size &&
    [...existingTokens].every((token) => nextTokens.has(token))
  ) {
    return true;
  }

  return false;
}

function assessContributionFit(
  prompt: string,
  ruleText: string,
  userCorrection: string,
): EvalContributionAssessment {
  const text = `${prompt} ${ruleText} ${userCorrection}`.toLowerCase();

  const personalSignals = [
    'my ',
    'our ',
    'team ',
    'company ',
    'personal preference',
    'i prefer',
    'we prefer',
    'local workflow',
    'specific repo',
    'my project',
    'our project',
  ].filter((signal) => text.includes(signal));

  const broadSignals = [
    'ask for clarification',
    'current information',
    'confirmation',
    'destructive',
    'inspect',
    'read',
    'search',
    'tool',
    'memory',
    'plan mode',
    'subagent',
  ].filter((signal) => text.includes(signal));

  if (personalSignals.length >= 2) {
    return {
      verdict: 'likely-personal',
      reasons: [
        'The description reads like a repo-specific or team-specific workflow preference.',
        'Review locally before proposing upstream.',
      ],
    };
  }

  if (personalSignals.length === 1 || broadSignals.length === 0) {
    return {
      verdict: 'needs-review',
      reasons: [
        'This eval may still be useful, but the behavior does not read as obviously general-purpose.',
        'Compare it against existing evals before contributing upstream.',
      ],
    };
  }

  return {
    verdict: 'likely-upstream',
    reasons: [
      'The described behavior looks broadly applicable to Gemini CLI users.',
      'It targets agent behavior rather than a one-off repository preference.',
    ],
  };
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function safeParseJson(text: string): unknown {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function parseGenerationResponse(
  text: string,
): Partial<GenerationResponse> | null {
  const parsed = safeParseJson(text);
  return isRecord(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
