/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.js';
import { LlmRole } from '../telemetry/llmRole.js';
import type { DetectionResult } from './types.js';

const CONFIDENCE_THRESHOLD = 0.65;

/**
 * Uses a Flash model to detect whether the user's follow-up message
 * is correcting a mistake made by the agent.
 *
 * High-precision design: only returns detected=true when confidence >= 0.8.
 * False negatives are acceptable; false positives erode user trust.
 */
export async function detectMisbehavior(
  contentGenerator: ContentGenerator,
  agentResponseSummary: string,
  userFollowUp: string,
  model?: string,
): Promise<DetectionResult> {
  const prompt = buildDetectionPrompt(agentResponseSummary, userFollowUp);

  try {
    const response = await contentGenerator.generateContent(
      {
        model: model ?? 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      },
      'eval-detection',
      LlmRole.UTILITY_TOOL,
    );

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const parsed = safeParseJson(text);
    if (!parsed) {
      return noDetection();
    }

    const result = parsed as Partial<DetectionResult>;
    const confidence =
      typeof result.confidence === 'number' ? result.confidence : 0;

    return {
      detected: confidence >= CONFIDENCE_THRESHOLD && result.detected === true,
      confidence,
      description:
        typeof result.description === 'string' ? result.description : '',
      behavior: typeof result.behavior === 'string' ? result.behavior : '',
    };
  } catch {
    // Detection is best-effort — never surface errors to user
    return noDetection();
  }
}

function buildDetectionPrompt(
  agentResponseSummary: string,
  userFollowUp: string,
): string {
  return `You are evaluating whether a user is correcting a mistake made by an AI coding agent.

AGENT'S PREVIOUS RESPONSE:
${agentResponseSummary.slice(0, 2000)}

USER'S FOLLOW-UP MESSAGE:
${userFollowUp.slice(0, 500)}

Is the user correcting a mistake the agent made? Return JSON only:
{
  "detected": boolean,
  "confidence": number (0.0 to 1.0),
  "description": "one sentence: what the agent did wrong",
  "behavior": "the specific action that was incorrect"
}

Return detected=true (confidence >= 0.65) when:
- The user is correcting a specific mistake the agent made
- The user is stating a behavioral preference or rule the agent should follow ("I want you to always X", "you should Y every time", "make sure you Z")
- The user expresses dissatisfaction with how the agent behaved

Return detected=false (confidence < 0.5) if:
- The user is adding a brand new unrelated request or task
- The user changed their own mind and the agent did exactly what was asked
- The user is asking a follow-up question with no implicit correction
- The user's message is clearly unrelated to the previous agent response`;
}

function safeParseJson(text: string): unknown {
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function noDetection(): DetectionResult {
  return { detected: false, confidence: 0, description: '', behavior: '' };
}
