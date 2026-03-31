/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proposeEvalUpstream } from '../../utils/proposeEvalUpstream.js';
import { theme } from '../../semantic-colors.js';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { useUIState } from '../../contexts/UIStateContext.js';
import { useTextBuffer } from '../shared/text-buffer.js';
import { TextInput } from '../shared/TextInput.js';
import {
  coreEvents,
  CoreEvent,
  analyzeCoverage,
  fetchEvalRegistryWithStatus,
  generateEvalDraft,
  type ContentGenerator,
  type EvalDraft,
  type EvalContributionAssessment,
  type EvalRuleManager,
  type RegistryEval,
  type LocalEvalIndex,
  type CoverageReport,
} from '@google/gemini-cli-core';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'installed' | 'coverage' | 'generate' | 'rules';

interface EvalItem {
  key: string;
  name: string;
  description?: string;
  source: 'official' | 'community' | 'generated';
  category: string;
  enabled: boolean;
  installed: boolean;
  passRate?: number;
  runs?: number;
}

interface SelectedEvalDetail {
  lines: string[];
}

export interface EvalsMarketplaceViewProps {
  manager: EvalRuleManager;
  projectRoot: string;
  getContentGenerator: () => ContentGenerator | null;
  getModel: () => string | undefined;
  onClose: () => void;
}

function renderContributionAssessment(
  assessment?: EvalContributionAssessment,
): string[] {
  if (!assessment) {
    return ['Contribution fit: not assessed'];
  }

  const header =
    assessment.verdict === 'likely-upstream'
      ? 'Contribution fit: likely upstream'
      : assessment.verdict === 'likely-personal'
        ? 'Contribution fit: likely personal/local'
        : 'Contribution fit: review before upstreaming';

  return [header, ...assessment.reasons.map((reason) => `- ${reason}`)];
}

function stripRuleFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, '').trim();
}

// ─── Coverage panel ───────────────────────────────────────────────────────────

const BAR_WIDTH = 12;
function bar(n: number, max: number) {
  const f = max > 0 ? Math.round((n / max) * BAR_WIDTH) : 0;
  return '█'.repeat(f) + '░'.repeat(BAR_WIDTH - f);
}

function CoveragePanel({ projectRoot }: { projectRoot: string }) {
  const [report, setReport] = useState<CoverageReport | null>(null);

  useEffect(() => {
    const evalsDir = join(projectRoot, '.gemini', 'evals');
    void analyzeCoverage(evalsDir)
      .then(setReport)
      .catch(() => {
        // Fallback: try project root evals/ dir (for evalkit repo users)
        void analyzeCoverage(join(projectRoot, 'evals'))
          .then(setReport)
          .catch(() => {
            setReport({
              tools: [],
              behavioral: [],
              suggestions: [],
              totalGaps: 0,
              generatedAt: new Date().toISOString(),
            });
          });
      });
  }, [projectRoot]);

  if (!report) {
    return (
      <Box paddingX={1}>
        <Text color={theme.text.secondary}>Analyzing coverage...</Text>
      </Box>
    );
  }

  const maxT = Math.max(...report.tools.map((t) => t.evalCount), 1);
  const maxB = Math.max(...report.behavioral.map((b) => b.evalCount), 1);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.text.primary}>
        Tool Coverage
      </Text>
      {report.tools.length === 0 && (
        <Box marginLeft={2}>
          <Text color={theme.text.secondary}>
            No eval files found. Generate evals with /generate-eval or the
            Generate tab.
          </Text>
        </Box>
      )}
      {report.tools.map((t) => (
        <Box key={t.name} flexDirection="row" gap={1} marginLeft={2}>
          <Box width={22}>
            <Text color={t.isGap ? theme.status.warning : theme.text.primary}>
              {t.name.padEnd(22).slice(0, 22)}
            </Text>
          </Box>
          <Text color={t.isGap ? theme.status.warning : theme.status.success}>
            {bar(t.evalCount, maxT)}
          </Text>
          <Text color={theme.text.secondary}>
            {String(t.evalCount).padStart(2)} evals{t.isGap ? ' ⚠' : ''}
          </Text>
        </Box>
      ))}
      <Box height={1} />
      <Text bold color={theme.text.primary}>
        Behavioral Coverage
      </Text>
      {report.behavioral.map((b) => (
        <Box key={b.category} flexDirection="row" gap={1} marginLeft={2}>
          <Box width={22}>
            <Text color={b.isGap ? theme.status.warning : theme.text.primary}>
              {b.category.padEnd(22).slice(0, 22)}
            </Text>
          </Box>
          <Text color={b.isGap ? theme.status.warning : theme.status.success}>
            {bar(b.evalCount, maxB)}
          </Text>
          <Text color={theme.text.secondary}>
            {String(b.evalCount).padStart(2)} cases{b.isGap ? ' ⚠' : ''}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        {report.totalGaps > 0 ? (
          <Text color={theme.status.warning}>
            {report.totalGaps} gap{report.totalGaps !== 1 ? 's' : ''} — use the
            Generate tab to fill them.
          </Text>
        ) : (
          <Text color={theme.status.success}>
            Full coverage across all known tools and patterns.
          </Text>
        )}
      </Box>
      {report.suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text.primary}>
            Suggested Next Evals
          </Text>
          {report.suggestions.map((suggestion) => (
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
                <Text color={theme.text.secondary} wrap="wrap">
                  {suggestion.rationale}
                </Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={theme.text.primary} wrap="wrap">
                  {`/generate-eval ${suggestion.prompt}`}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── Rules panel ─────────────────────────────────────────────────────────────

function RulesPanel({
  projectRoot,
  refreshKey,
}: {
  projectRoot: string;
  refreshKey: number;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setError(null);
    void readFile(join(projectRoot, '.gemini', 'GEMINI.md'), 'utf8')
      .then((text) => setContent(text))
      .catch(() => {
        void readFile(join(projectRoot, 'GEMINI.md'), 'utf8')
          .then((text) => setContent(text))
          .catch(() =>
            setError('No GEMINI.md found. Install an eval to create one.'),
          );
      });
  }, [projectRoot, refreshKey]);

  if (error)
    return (
      <Box paddingX={1}>
        <Text color={theme.text.secondary}>{error}</Text>
      </Box>
    );
  if (content === null)
    return (
      <Box paddingX={1}>
        <Text color={theme.text.secondary}>Loading...</Text>
      </Box>
    );

  type Segment =
    | { text: string; isRule: false }
    | { ruleName: string; ruleText: string; isRule: true };
  const segments: Segment[] = [];
  const blockRegex =
    /[ \t]*<!-- eval-rule:([^:]+):start -->([\s\S]*?)<!-- eval-rule:[^:]+:end -->[ \t]*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: content.slice(lastIndex, match.index),
        isRule: false,
      });
    }
    segments.push({
      ruleName: match[1],
      ruleText: match[2].trim(),
      isRule: true,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), isRule: false });
  }

  const ruleSegments = segments.filter(
    (s): s is Extract<Segment, { isRule: true }> => s.isRule,
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.text.primary}>
        Active Rules (.gemini/GEMINI.md)
      </Text>
      <Box height={1} />
      {segments.map((seg, i) =>
        seg.isRule ? (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text bold color={theme.status.success}>
              ● {seg.ruleName}
            </Text>
            <Box marginLeft={2}>
              <Text color={theme.text.primary} wrap="wrap">
                {seg.ruleText}
              </Text>
            </Box>
          </Box>
        ) : seg.text.trim() ? (
          <Text key={i} color={theme.text.secondary} wrap="wrap">
            {seg.text.trim()}
          </Text>
        ) : null,
      )}
      {ruleSegments.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            No eval rules installed yet. Go to All tab and press Enter to
            install.
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Generate panel ───────────────────────────────────────────────────────────

interface GeneratePanelProps {
  manager: EvalRuleManager;
  getContentGenerator: () => ContentGenerator | null;
  getModel: () => string | undefined;
  onGenerated: () => void;
  terminalWidth: number;
}

function GeneratePanel({
  manager,
  getContentGenerator,
  getModel,
  onGenerated,
  terminalWidth,
}: GeneratePanelProps) {
  const [status, setStatus] = useState<
    'idle' | 'generating' | 'done' | 'error'
  >('idle');
  const [resultLines, setResultLines] = useState<string[]>([]);

  const buffer = useTextBuffer({
    initialText: '',
    initialCursorOffset: 0,
    viewport: { width: Math.max(40, terminalWidth - 6), height: 3 },
    singleLine: false,
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      const correction = value.trim();
      if (!correction || status !== 'idle') return;

      const contentGenerator = getContentGenerator();
      if (!contentGenerator) {
        setStatus('error');
        setResultLines([
          'No content generator available.',
          'Use: /generate-eval ' + correction,
        ]);
        return;
      }

      setStatus('generating');
      setResultLines(['Generating eval-rule combo...']);

      try {
        const index = await manager.readIndex();
        const existingNames = [
          ...index.installed.map((e) => e.name),
          ...index.generated.map((e) => e.name),
        ];

        const ctx = {
          originalPrompt: '(generated from /evals UI)',
          agentResponseSummary: '(manually specified)',
          userCorrection: correction,
          detectionDescription: correction,
          relevantFiles: {} as Record<string, string>,
          capturedAt: new Date().toISOString(),
        };

        const draft = await generateEvalDraft(
          contentGenerator,
          ctx,
          existingNames,
          getModel(),
        );

        if (draft.duplicateOf) {
          setStatus('done');
          setResultLines([
            `Already covered by '${draft.duplicateOf}'. No new eval generated.`,
            ...(draft.duplicateCandidates?.length
              ? [`Similar evals: ${draft.duplicateCandidates.join(', ')}`]
              : []),
          ]);
          return;
        }

        await manager.saveGenerated(
          draft.suggestedName,
          draft.evalCode,
          draft.ruleCode,
          draft.category,
          {
            duplicateCandidates: draft.duplicateCandidates,
            contributionAssessment: draft.contributionAssessment,
          },
        );
        coreEvents.emit(CoreEvent.MemoryChanged, { fileCount: 1 });
        onGenerated();

        setStatus('done');
        setResultLines([
          `Saved '${draft.suggestedName}'.`,
          ...renderDraftAssessmentLines(draft),
          `.gemini/evals/${draft.suggestedName}.eval.ts`,
          `.gemini/eval-rules/${draft.suggestedName}.md  →  added to GEMINI.md`,
        ]);
      } catch (err) {
        setStatus('error');
        setResultLines([
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
    },
    [manager, getContentGenerator, getModel, onGenerated, status],
  );

  useKeypress(
    useCallback(
      (key: Key) => {
        if (
          (key.name === 'enter' || key.name === 'return') &&
          !key.shift &&
          status === 'idle'
        ) {
          void handleSubmit(buffer.text);
          return true;
        }
        // Allow resetting after done/error
        if (key.name === 'r' && (status === 'done' || status === 'error')) {
          setStatus('idle');
          setResultLines([]);
          return true;
        }
        return false;
      },
      [buffer.text, handleSubmit, status],
    ),
    { isActive: true, priority: false },
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.text.primary}>
        Generate Eval-Rule Combo
      </Text>
      <Box height={1} />
      {status === 'idle' || status === 'generating' ? (
        <>
          <Text color={theme.text.secondary}>
            Describe what the agent did wrong, or what rule it should follow:
          </Text>
          <Box
            marginTop={1}
            borderStyle="single"
            borderColor={theme.border.default}
            paddingX={1}
          >
            <TextInput
              buffer={buffer}
              placeholder="e.g. agent should have asked for clarification first"
              onSubmit={(v) => {
                void handleSubmit(v);
              }}
              focus={status === 'idle'}
            />
          </Box>
          <Box marginTop={1}>
            {status === 'idle' ? (
              <Text color={theme.text.secondary}>
                Enter to generate · Esc to close
              </Text>
            ) : (
              <Text color={theme.text.accent}>Generating...</Text>
            )}
          </Box>
        </>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {resultLines.map((line, i) => (
            <Text
              key={i}
              color={
                i === 0 && status === 'done'
                  ? theme.status.success
                  : status === 'error' && i === 0
                    ? theme.status.warning
                    : theme.text.secondary
              }
            >
              {line}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              r to generate another · Esc to close
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function renderDraftAssessmentLines(draft: EvalDraft): string[] {
  const lines = draft.duplicateCandidates?.length
    ? [`Similar evals to review: ${draft.duplicateCandidates.join(', ')}`]
    : ['Similar evals to review: none found'];

  const assessment = draft.contributionAssessment;
  if (!assessment) {
    return lines;
  }

  lines.push(
    assessment.verdict === 'likely-upstream'
      ? 'Contribution fit: likely upstream'
      : assessment.verdict === 'likely-personal'
        ? 'Contribution fit: likely personal/local'
        : 'Contribution fit: review before upstreaming',
  );
  lines.push(...assessment.reasons.map((reason) => `- ${reason}`));
  return lines;
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'generate', label: 'Generate' },
  { id: 'rules', label: 'GEMINI.md' },
];

const TAB_ORDER: Tab[] = ['all', 'installed', 'coverage', 'generate', 'rules'];

function TabBar({ active }: { active: Tab }) {
  return (
    <Box flexDirection="row" gap={0} marginBottom={1}>
      {TABS.map((t, i) => (
        <React.Fragment key={t.id}>
          <Text
            bold={active === t.id}
            color={active === t.id ? theme.text.primary : theme.text.secondary}
            underline={active === t.id}
          >
            {t.label}
          </Text>
          {i < TABS.length - 1 && <Text color={theme.text.secondary}> </Text>}
        </React.Fragment>
      ))}
    </Box>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function EvalsMarketplaceView({
  manager,
  projectRoot,
  getContentGenerator,
  getModel,
  onClose,
}: EvalsMarketplaceViewProps): React.JSX.Element {
  const { terminalHeight, staticExtraHeight, terminalWidth } = useUIState();
  const [tab, setTab] = useState<Tab>('all');
  const [index, setIndex] = useState<LocalEvalIndex>({
    installed: [],
    generated: [],
  });
  const [registryEvals, setRegistryEvals] = useState<RegistryEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [registryNotice, setRegistryNotice] = useState<string | null>(null);
  const [rulesRefreshKey, setRulesRefreshKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [proposeConfirm, setProposeConfirm] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<SelectedEvalDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const maxVisible = Math.max(
    3,
    Math.floor(Math.max(0, terminalHeight - staticExtraHeight - 12) / 3),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [idx, registryResult] = await Promise.all([
          manager.readIndex(),
          fetchEvalRegistryWithStatus().catch((err) => ({
            registry: { version: '0', updatedAt: '', evals: [] },
            source: 'cache' as const,
            stale: true,
            fetchedAt: undefined,
            error: err instanceof Error ? err.message : String(err),
          })),
        ]);
        if (cancelled) return;
        setIndex(idx);
        if (!cancelled) {
          setRegistryEvals(registryResult.registry.evals);
          setRegistryNotice(
            registryResult.error
              ? registryResult.registry.evals.length > 0
                ? `Marketplace unavailable; showing cached registry from ${registryResult.fetchedAt ?? 'earlier in this session'}.`
                : 'Marketplace unavailable; generated and installed evals are still available locally.'
              : registryResult.source === 'cache'
                ? `Marketplace loaded from cache (${registryResult.fetchedAt ?? 'this session'}).`
                : null,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager]);

  const allItems: EvalItem[] = useMemo(() => {
    const installedMap = new Map(index.installed.map((e) => [e.name, e]));
    const fromRegistry: EvalItem[] = registryEvals.map((e) => ({
      key: e.name,
      name: e.name,
      description: e.description,
      source: e.official ? 'official' : 'community',
      category: e.category,
      enabled: installedMap.get(e.name)?.enabled ?? false,
      installed: installedMap.has(e.name),
    }));
    const fromGenerated: EvalItem[] = index.generated.map((e) => ({
      key: e.name,
      name: e.name,
      description: e.description ?? e.name,
      source: 'generated' as const,
      category: 'generated',
      enabled: e.enabled,
      installed: true,
      passRate: e.analytics?.passRate,
      runs: e.analytics?.runs,
    }));
    const seen = new Set<string>();
    const out: EvalItem[] = [];
    for (const item of [...fromRegistry, ...fromGenerated]) {
      if (!seen.has(item.key)) {
        seen.add(item.key);
        out.push(item);
      }
    }
    return out;
  }, [registryEvals, index]);

  const categories = useMemo(() => {
    const cats = [...new Set(allItems.map((e) => e.category))].sort();
    return cats;
  }, [allItems]);

  const visibleItems = useMemo(() => {
    let items =
      tab === 'installed' ? allItems.filter((e) => e.installed) : allItems;
    if (categoryFilter)
      items = items.filter((e) => e.category === categoryFilter);
    return items;
  }, [allItems, tab, categoryFilter]);

  // Reset cursor when tab or filter changes
  useEffect(() => {
    setCursor(0);
    setScrollOffset(0);
  }, [tab, categoryFilter]);

  // Keep cursor in bounds
  useEffect(() => {
    if (visibleItems.length === 0) return;
    setCursor((c) => Math.min(c, visibleItems.length - 1));
  }, [visibleItems.length]);

  const refreshIndex = useCallback(async () => {
    const updated = await manager.readIndex();
    setIndex(updated);
  }, [manager]);

  const toggleSelected = useCallback(async () => {
    const item = visibleItems[cursor];
    if (!item) return;

    try {
      if (item.source === 'generated') {
        // Toggle enabled state for generated evals
        await manager.setEnabled(item.key, !item.enabled);
        setActionMsg(
          item.enabled ? `Disabled '${item.key}'.` : `Enabled '${item.key}'.`,
        );
      } else if (item.installed) {
        await manager.uninstall(item.key);
        setActionMsg(`Uninstalled '${item.key}'.`);
      } else {
        const reg = registryEvals.find((e) => e.name === item.key);
        if (!reg) return;
        await manager.install(reg);
        setActionMsg(`Installed '${item.key}'. Rule active immediately.`);
      }
      coreEvents.emit(CoreEvent.MemoryChanged, { fileCount: 1 });
      setRulesRefreshKey((k) => k + 1);
    } catch (err) {
      setActionMsg(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await refreshIndex();
    setTimeout(() => setActionMsg(null), 3000);
  }, [visibleItems, cursor, manager, registryEvals, refreshIndex]);

  const isListTab = tab === 'all' || tab === 'installed';

  const selectedItem = visibleItems[cursor] ?? null;
  const selectedIsGenerated = selectedItem?.source === 'generated';

  useEffect(() => {
    let cancelled = false;

    if (!selectedItem || !isListTab) {
      setSelectedDetail(null);
      setDetailsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const installedEntry = index.installed.find(
      (entry) => entry.name === selectedItem.key,
    );
    const generatedEntry = index.generated.find(
      (entry) => entry.name === selectedItem.key,
    );
    const registryEntry = registryEvals.find(
      (entry) => entry.name === selectedItem.key,
    );

    void (async () => {
      setDetailsLoading(true);

      const lines: string[] = [
        `status: ${
          generatedEntry
            ? generatedEntry.enabled
              ? 'generated/enabled'
              : 'generated/disabled'
            : installedEntry
              ? installedEntry.enabled
                ? 'installed/enabled'
                : 'installed/disabled'
              : 'available in marketplace'
        }`,
        `source: ${selectedItem.source}`,
        `category: ${selectedItem.category}`,
      ];

      if (selectedItem.description) {
        lines.push(`description: ${selectedItem.description}`);
      }
      if (registryEntry) {
        lines.push(`registry eval: ${registryEntry.evalFile}`);
        lines.push(`author: ${registryEntry.author}`);
        lines.push(`added: ${registryEntry.addedAt}`);
      }
      if (generatedEntry) {
        lines.push(`local eval: ${generatedEntry.evalFile}`);
        lines.push(`local rule: ${generatedEntry.ruleFile}`);
        if (generatedEntry.duplicateCandidates?.length) {
          lines.push(
            `similar evals: ${generatedEntry.duplicateCandidates.join(', ')}`,
          );
        }
        lines.push(
          ...renderContributionAssessment(
            generatedEntry.contributionAssessment,
          ),
        );
      }
      if (installedEntry) {
        lines.push(
          `analytics: ${Math.round(installedEntry.analytics.passRate * 100)}% (${installedEntry.analytics.runs} runs)`,
        );
      }
      if (generatedEntry) {
        lines.push(
          `analytics: ${Math.round(generatedEntry.analytics.passRate * 100)}% (${generatedEntry.analytics.runs} runs)`,
        );
      }

      let rulePreview = registryEntry?.ruleFragment;
      if (!rulePreview && generatedEntry?.ruleFile) {
        try {
          rulePreview = stripRuleFrontmatter(
            await readFile(generatedEntry.ruleFile, 'utf8'),
          );
        } catch {
          rulePreview = undefined;
        }
      } else if (!rulePreview && installedEntry?.ruleFile) {
        try {
          rulePreview = stripRuleFrontmatter(
            await readFile(installedEntry.ruleFile, 'utf8'),
          );
        } catch {
          rulePreview = undefined;
        }
      }
      if (rulePreview) {
        lines.push('rule preview:');
        lines.push(rulePreview.split('\n').slice(0, 4).join('\n'));
      }
      if (registryNotice) {
        lines.push(`registry: ${registryNotice}`);
      }

      if (!cancelled) {
        setSelectedDetail({ lines });
        setDetailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedItem, isListTab, index, registryEvals, registryNotice]);

  const proposeUpstream = useCallback(async () => {
    if (!selectedItem || !selectedIsGenerated) return;
    const generatedEntry = index.generated.find(
      (entry) => entry.name === selectedItem.name,
    );
    const verdict = generatedEntry?.contributionAssessment?.verdict;
    if (
      proposeConfirm !== selectedItem.name &&
      verdict &&
      verdict !== 'likely-upstream'
    ) {
      setProposeConfirm(selectedItem.name);
      setActionMsg(
        verdict === 'likely-personal'
          ? `This eval looks personal/local. Press p again to propose anyway.`
          : `This eval needs review before upstreaming. Press p again to continue.`,
      );
      return;
    }
    setProposeConfirm(null);
    const evalPath = join(
      projectRoot,
      '.gemini',
      'evals',
      `${selectedItem.name}.eval.ts`,
    );
    setActionMsg('Creating fork and PR...');
    const result = await proposeEvalUpstream(evalPath, selectedItem.name);
    setActionMsg(result.message);
    setTimeout(() => setActionMsg(null), result.success ? 8000 : 6000);
  }, [selectedItem, selectedIsGenerated, projectRoot, index, proposeConfirm]);

  const deleteSelected = useCallback(async () => {
    if (!selectedItem || !selectedIsGenerated) return;
    if (deleteConfirm !== selectedItem.key) {
      setDeleteConfirm(selectedItem.key);
      setActionMsg(
        `Press d again to delete '${selectedItem.name}' · any other key cancels`,
      );
      return;
    }
    setDeleteConfirm(null);
    try {
      await manager.deleteGenerated(selectedItem.key);
      coreEvents.emit(CoreEvent.MemoryChanged, { fileCount: 1 });
      setRulesRefreshKey((k) => k + 1);
      setActionMsg(`Deleted '${selectedItem.name}'.`);
      await refreshIndex();
    } catch (err) {
      setActionMsg(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    setTimeout(() => setActionMsg(null), 3000);
  }, [selectedItem, selectedIsGenerated, deleteConfirm, manager, refreshIndex]);

  useKeypress(
    useCallback(
      (key: Key) => {
        if (key.name === 'escape') {
          onClose();
          return true;
        }

        if (key.name === 'left') {
          setTab((prev) => {
            const i = TAB_ORDER.indexOf(prev);
            return i > 0 ? TAB_ORDER[i - 1] : prev;
          });
          return true;
        }
        if (key.name === 'right') {
          setTab((prev) => {
            const i = TAB_ORDER.indexOf(prev);
            return i < TAB_ORDER.length - 1 ? TAB_ORDER[i + 1] : prev;
          });
          return true;
        }

        if (!isListTab) return false;

        if (key.name === 'up' || (key.name === 'k' && !key.ctrl)) {
          setCursor((c) => {
            const next = Math.max(0, c - 1);
            setScrollOffset((s) => Math.min(s, next));
            return next;
          });
          return true;
        }
        if (key.name === 'down' || (key.name === 'j' && !key.ctrl)) {
          setCursor((c) => {
            const next = Math.min(visibleItems.length - 1, c + 1);
            setScrollOffset((s) =>
              next >= s + maxVisible ? next - maxVisible + 1 : s,
            );
            return next;
          });
          return true;
        }
        if (
          key.name === 'enter' ||
          key.name === 'return' ||
          key.name === 'space'
        ) {
          void toggleSelected();
          return true;
        }
        // p key → propose selected generated eval upstream
        if (key.name === 'p' && !key.ctrl && selectedIsGenerated) {
          void proposeUpstream();
          return true;
        }
        // d key → delete selected generated eval (with confirmation)
        if (key.name === 'd' && !key.ctrl && selectedIsGenerated) {
          void deleteSelected();
          return true;
        }
        // any other key clears delete confirmation
        if (deleteConfirm) {
          setDeleteConfirm(null);
          setActionMsg(null);
        }
        if (proposeConfirm) {
          setProposeConfirm(null);
        }
        // f key → cycle category filter
        if (key.name === 'f' && !key.ctrl) {
          setCategoryFilter((prev) => {
            if (!prev) return categories[0] ?? null;
            const i = categories.indexOf(prev);
            return i >= categories.length - 1 ? null : categories[i + 1];
          });
          return true;
        }
        return false;
      },
      [
        onClose,
        isListTab,
        visibleItems.length,
        maxVisible,
        toggleSelected,
        categories,
        selectedIsGenerated,
        proposeUpstream,
        deleteSelected,
        deleteConfirm,
        proposeConfirm,
      ],
    ),
    { isActive: true, priority: true },
  );

  if (loading) {
    return (
      <Box padding={1}>
        <Text color={theme.text.secondary}>Loading evals...</Text>
      </Box>
    );
  }

  const slicedItems = visibleItems.slice(
    scrollOffset,
    scrollOffset + maxVisible,
  );

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <TabBar active={tab} />

      {tab === 'rules' ? (
        <RulesPanel projectRoot={projectRoot} refreshKey={rulesRefreshKey} />
      ) : tab === 'coverage' ? (
        <CoveragePanel projectRoot={projectRoot} />
      ) : tab === 'generate' ? (
        <GeneratePanel
          manager={manager}
          getContentGenerator={getContentGenerator}
          getModel={getModel}
          onGenerated={refreshIndex}
          terminalWidth={terminalWidth ?? 80}
        />
      ) : (
        <Box flexDirection="column">
          {/* Category filter row */}
          <Box flexDirection="row" gap={1} marginBottom={1} flexWrap="wrap">
            <Text color={theme.text.secondary}>filter:</Text>
            <Text
              bold={categoryFilter === null}
              color={
                categoryFilter === null
                  ? theme.text.primary
                  : theme.text.secondary
              }
            >
              all
            </Text>
            {categories.map((cat) => (
              <Text
                key={cat}
                bold={categoryFilter === cat}
                color={
                  categoryFilter === cat
                    ? theme.status.success
                    : theme.text.secondary
                }
              >
                {cat}
              </Text>
            ))}
            <Text color={theme.text.secondary}>(f to cycle)</Text>
          </Box>

          <Box marginBottom={1}>
            <Text bold color={theme.text.primary}>
              {tab === 'installed' ? 'Installed' : 'All'} Evals (
              {visibleItems.length}
              {categoryFilter ? ` · ${categoryFilter}` : ''})
            </Text>
          </Box>

          {visibleItems.length === 0 ? (
            <Box marginLeft={2}>
              <Text color={theme.text.secondary}>
                {tab === 'installed'
                  ? 'No evals installed. Switch to All to browse.'
                  : 'No evals available.'}
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {scrollOffset > 0 && (
                <Box marginLeft={1}>
                  <Text color={theme.text.secondary}>▲ more above</Text>
                </Box>
              )}
              {slicedItems.map((item, i) => {
                const isActive = scrollOffset + i === cursor;
                const badge =
                  item.source === 'official'
                    ? '[official]'
                    : item.source === 'community'
                      ? '[community]'
                      : '[generated]';
                const passInfo =
                  item.runs && item.runs > 0 && item.passRate !== undefined
                    ? ` ${Math.round(item.passRate * 100)}% (${item.runs} runs)`
                    : '';

                return (
                  <Box
                    key={item.key}
                    flexDirection="column"
                    marginBottom={1}
                    marginLeft={1}
                  >
                    <Box flexDirection="row" gap={1}>
                      <Text
                        color={
                          isActive ? theme.status.success : theme.text.secondary
                        }
                      >
                        {isActive ? '▶' : ' '}
                      </Text>
                      <Text
                        color={
                          (
                            item.source === 'generated'
                              ? item.enabled
                              : item.installed
                          )
                            ? theme.status.success
                            : theme.text.secondary
                        }
                      >
                        {(
                          item.source === 'generated'
                            ? item.enabled
                            : item.installed
                        )
                          ? '●'
                          : '○'}
                      </Text>
                      <Text
                        bold
                        color={
                          isActive ? theme.status.success : theme.text.primary
                        }
                      >
                        {item.name}
                      </Text>
                      <Text color={theme.text.secondary}>{badge}</Text>
                      <Text color={theme.text.secondary}>{item.category}</Text>
                      {passInfo && (
                        <Text
                          color={
                            (item.passRate ?? 0) >= 0.9
                              ? theme.status.success
                              : theme.status.warning
                          }
                        >
                          {passInfo}
                        </Text>
                      )}
                    </Box>
                    {item.description && (
                      <Box marginLeft={4}>
                        <Text color={theme.text.secondary} wrap="truncate-end">
                          {item.description}
                        </Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
              {scrollOffset + maxVisible < visibleItems.length && (
                <Box marginLeft={1}>
                  <Text color={theme.text.secondary}>▼ more below</Text>
                </Box>
              )}
            </Box>
          )}

          {selectedItem && (
            <Box flexDirection="column" marginTop={1} marginLeft={1}>
              <Text bold color={theme.text.primary}>
                Selected: {selectedItem.name}
              </Text>
              {detailsLoading ? (
                <Text color={theme.text.secondary}>Loading details...</Text>
              ) : selectedDetail ? (
                selectedDetail.lines.map((line, i) => (
                  <Text
                    key={`${selectedItem.key}-${i}`}
                    color={i === 0 ? theme.text.secondary : theme.text.primary}
                    wrap="wrap"
                  >
                    {line}
                  </Text>
                ))
              ) : (
                <Text color={theme.text.secondary}>No details available.</Text>
              )}
            </Box>
          )}

          <Box marginTop={1} flexDirection="row" gap={2}>
            {actionMsg && <Text color={theme.status.success}>{actionMsg}</Text>}
            {!actionMsg && registryNotice && (
              <Text color={theme.status.warning}>{registryNotice}</Text>
            )}
            <Text color={theme.text.secondary}>
              ↑↓ navigate · Enter toggle · f filter · ←→ tab · Esc close
              {selectedIsGenerated ? ' · p propose · d delete' : ''}
            </Text>
          </Box>
        </Box>
      )}

      {(tab === 'coverage' || tab === 'rules' || tab === 'generate') && (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>←→ switch tab · Esc close</Text>
        </Box>
      )}
    </Box>
  );
}
