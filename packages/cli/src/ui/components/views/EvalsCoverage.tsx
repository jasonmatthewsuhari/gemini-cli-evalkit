/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';

interface EvalsCoverageProps {
  tools: Array<{ name: string; evalCount: number; isGap: boolean }>;
  behavioral: Array<{ category: string; evalCount: number; isGap: boolean }>;
  suggestions: Array<{
    kind: 'tool' | 'behavior';
    target: string;
    category: string;
    prompt: string;
    rationale: string;
    upstreamPotential: 'high' | 'medium';
  }>;
  totalGaps: number;
}

const BAR_WIDTH = 10;

function renderBar(count: number, max: number): string {
  const filled = max > 0 ? Math.round((count / max) * BAR_WIDTH) : 0;
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

export const EvalsCoverage: React.FC<EvalsCoverageProps> = ({
  tools,
  behavioral,
  suggestions,
  totalGaps,
}) => {
  const maxToolCount = Math.max(...tools.map((t) => t.evalCount), 1);
  const maxBehavioralCount = Math.max(...behavioral.map((b) => b.evalCount), 1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.text.primary}>
        Eval Coverage
      </Text>
      <Box height={1} />

      <Text bold color={theme.text.primary}>
        Tool Coverage
      </Text>
      {tools.map((tool) => (
        <Box key={tool.name} flexDirection="row" gap={1} marginLeft={2}>
          <Box width={22}>
            <Text
              color={tool.isGap ? theme.status.warning : theme.text.primary}
              bold={tool.isGap}
            >
              {tool.name.padEnd(22).slice(0, 22)}
            </Text>
          </Box>
          <Text
            color={tool.isGap ? theme.status.warning : theme.status.success}
          >
            {renderBar(tool.evalCount, maxToolCount)}
          </Text>
          <Text color={theme.text.secondary}>
            {String(tool.evalCount).padStart(2)} eval
            {tool.evalCount !== 1 ? 's' : ' '}
          </Text>
          {tool.isGap && (
            <Text color={theme.status.warning} bold>
              ⚠
            </Text>
          )}
        </Box>
      ))}

      <Box height={1} />
      <Text bold color={theme.text.primary}>
        Behavioral Coverage
      </Text>
      {behavioral.map((b) => (
        <Box key={b.category} flexDirection="row" gap={1} marginLeft={2}>
          <Box width={22}>
            <Text
              color={b.isGap ? theme.status.warning : theme.text.primary}
              bold={b.isGap}
            >
              {b.category.padEnd(22).slice(0, 22)}
            </Text>
          </Box>
          <Text color={b.isGap ? theme.status.warning : theme.status.success}>
            {renderBar(b.evalCount, maxBehavioralCount)}
          </Text>
          <Text color={theme.text.secondary}>
            {String(b.evalCount).padStart(2)} case
            {b.evalCount !== 1 ? 's' : ' '}
          </Text>
          {b.isGap && (
            <Text color={theme.status.warning} bold>
              ⚠
            </Text>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        {totalGaps > 0 ? (
          <Text color={theme.status.warning}>
            {totalGaps} coverage gap{totalGaps !== 1 ? 's' : ''} identified. Run
            /generate-eval to fill them.
          </Text>
        ) : (
          <Text color={theme.status.success}>
            Full coverage across all known tools and patterns.
          </Text>
        )}
      </Box>

      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text.primary}>
            Suggested Next Evals
          </Text>
          {suggestions.map((suggestion) => (
            <Box
              key={`${suggestion.kind}:${suggestion.target}`}
              flexDirection="column"
              marginLeft={2}
              marginTop={1}
            >
              <Box flexDirection="row" gap={1}>
                <Text color={theme.status.warning}>-</Text>
                <Text bold color={theme.text.primary}>
                  {suggestion.target}
                </Text>
                <Text color={theme.text.secondary}>[{suggestion.kind}]</Text>
                <Text
                  color={
                    suggestion.upstreamPotential === 'high'
                      ? theme.status.success
                      : theme.status.warning
                  }
                >
                  {suggestion.upstreamPotential === 'high'
                    ? '[upstream-ready]'
                    : '[review-locally-first]'}
                </Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={theme.text.secondary}>{suggestion.rationale}</Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={theme.text.primary}>
                  {`/generate-eval ${suggestion.prompt}`}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
