/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeCoverage } from './coverageAnalyzer.js';

const tempDirs: string[] = [];

describe('analyzeCoverage', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => {
        const { rm } = await import('node:fs/promises');
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('adds actionable suggestions for uncovered tool and behavior gaps', async () => {
    const evalsDir = await mkdtemp(join(tmpdir(), 'coverage-analyzer-'));
    tempDirs.push(evalsDir);

    await mkdir(evalsDir, { recursive: true });
    await writeFile(
      join(evalsDir, 'answer-vs-act.eval.ts'),
      `
      describe('behavioral', () => {
        evalTest('USUALLY_PASSES', {
          name: 'should inspect without editing',
          prompt: 'inspect this file',
          assert: async (rig) => {
            const toolLogs = rig.readToolLogs();
            expect(toolLogs.some((log) => log.toolRequest.name === 'read_file')).toBe(true);
          },
        });
      });
      `,
      'utf8',
    );

    const report = await analyzeCoverage(evalsDir);

    const webSearch = report.tools.find(
      (entry) => entry.name === 'google_web_search',
    );
    expect(webSearch?.isGap).toBe(true);
    expect(webSearch?.suggestion).toMatchObject({
      kind: 'tool',
      target: 'google_web_search',
      upstreamPotential: 'high',
    });

    const errorRecovery = report.behavioral.find(
      (entry) => entry.category === 'error-recovery',
    );
    expect(errorRecovery?.isGap).toBe(true);
    expect(errorRecovery?.suggestion).toMatchObject({
      kind: 'behavior',
      target: 'error-recovery',
    });

    expect(report.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'google_web_search' }),
        expect.objectContaining({ target: 'error-recovery' }),
      ]),
    );
  });
});
