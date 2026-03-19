/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCommandRoots } from './shell-utils.js';

export const safeCommandAllowlist = new Set([
  'ls',
  'cat',
  'grep',
  'pwd',
  'echo',
  'head',
  'tail',
  'less',
  'more',
  'whoami',
  'date',
  'cd',
  'clear',
  'history',
  'man',
  'sort',
  'uniq',
  'wc',
  'diff',
  'ping',
]);

export const editCommandAllowlist = new Set([
  'cp',
  'mv',
  'mkdir',
  'touch',
  'rmdir',
  'chmod',
  'chown',
  'tar',
  'gzip',
  'gunzip',
  'unzip',
  'zip',
  'find',
  'awk',
  'sed',
]);

export function canShowAutoApproveCheckbox(
  command: string,
  isAcceptEdits: boolean,
): boolean {
  const baseCommands = getCommandRoots(command);

  if (baseCommands.length === 0) {
    return false;
  }

  return baseCommands.every(
    (baseCmd) =>
      safeCommandAllowlist.has(baseCmd) ||
      (isAcceptEdits && editCommandAllowlist.has(baseCmd)),
  );
}
