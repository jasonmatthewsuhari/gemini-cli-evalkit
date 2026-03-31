/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PendingEvalContext } from './types.js';

/**
 * Module-level store for the pending eval context.
 *
 * When the misbehavior detector fires, it writes context here.
 * When /generate-eval is triggered (via Ctrl+E or manually), it reads from here.
 * Cleared after consumption or on the next agent turn.
 */
let pendingContext: PendingEvalContext | null = null;

export function setPendingEvalContext(ctx: PendingEvalContext): void {
  pendingContext = ctx;
}

export function getPendingEvalContext(): PendingEvalContext | null {
  return pendingContext;
}

export function clearPendingEvalContext(): void {
  pendingContext = null;
}
