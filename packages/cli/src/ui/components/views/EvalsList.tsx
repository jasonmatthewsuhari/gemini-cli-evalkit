/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import type { EvalComboDisplay } from '../../types.js';

interface EvalsListProps {
  combos: readonly EvalComboDisplay[];
  title: string;
  view?: 'installed' | 'marketplace';
}

export const EvalsList: React.FC<EvalsListProps> = ({
  combos,
  title,
  view = 'installed',
}) => {
  const primary =
    view === 'marketplace'
      ? combos.filter((c) => c.installed)
      : combos.filter((c) => c.enabled);
  const secondary =
    view === 'marketplace'
      ? combos.filter((c) => !c.installed)
      : combos.filter((c) => !c.enabled);

  const renderCombo = (combo: EvalComboDisplay) => {
    const passRateStr =
      combo.runs && combo.runs > 0 && combo.passRate !== undefined
        ? ` ${Math.round(combo.passRate * 100)}% (${combo.runs} runs)`
        : '';

    const sourceLabel =
      combo.source === 'official'
        ? '[official]'
        : combo.source === 'community'
          ? '[community]'
          : '[generated]';
    const statusLabel =
      view === 'marketplace'
        ? combo.installed
          ? combo.enabled
            ? '[installed]'
            : '[installed/off]'
          : '[available]'
        : null;

    return (
      <Box key={combo.name} flexDirection="row" marginLeft={2}>
        <Text color={theme.text.primary}>- </Text>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text
              bold
              color={combo.enabled ? theme.text.link : theme.text.secondary}
            >
              {combo.name}
            </Text>
            <Text color={theme.text.secondary}>{sourceLabel}</Text>
            <Text color={theme.text.secondary}>{combo.category}</Text>
            {statusLabel ? (
              <Text
                color={
                  combo.installed ? theme.status.success : theme.text.secondary
                }
              >
                {statusLabel}
              </Text>
            ) : null}
            {passRateStr ? (
              <Text
                color={
                  (combo.passRate ?? 0) >= 0.9
                    ? theme.status.success
                    : (combo.passRate ?? 0) >= 0.7
                      ? theme.status.warning
                      : theme.status.error
                }
              >
                {passRateStr}
              </Text>
            ) : null}
          </Box>
          {combo.description && (
            <Box marginLeft={2}>
              <Text color={theme.text.primary}>{combo.description}</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.text.primary}>
        {title}
      </Text>
      <Box height={1} />

      {primary.length > 0 && (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            {view === 'marketplace' ? 'Installed:' : 'Enabled:'}
          </Text>
          {primary.map(renderCombo)}
        </Box>
      )}

      {secondary.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.text.secondary}>
            {view === 'marketplace' ? 'Available:' : 'Disabled:'}
          </Text>
          {secondary.map(renderCombo)}
        </Box>
      )}

      {combos.length === 0 && (
        <Text color={theme.text.secondary}>
          {view === 'marketplace'
            ? 'No marketplace evals available.'
            : 'No eval-rule combos installed. Run /evals browse to see available evals.'}
        </Text>
      )}

      <Box marginTop={1}>
        <Text color={theme.text.secondary} italic>
          {view === 'marketplace'
            ? 'Use /evals install <name> or /evals uninstall <name> to manage marketplace evals. Use /evals to open the full TUI.'
            : 'Use /evals enable <name> or /evals disable <name> to toggle. Use /evals browse to see the marketplace.'}
        </Text>
      </Box>
    </Box>
  );
};
