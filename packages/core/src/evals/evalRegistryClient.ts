/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvalRegistry, EvalRegistryFetchResult } from './types.js';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/jasonmatthewsuhari/gemini-cli-evalkit/main/eval-registry.json';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  registry: EvalRegistry;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let fetchPromise: Promise<EvalRegistry> | null = null;

function getFetchedAt(entry: CacheEntry | null): string | undefined {
  return entry ? new Date(entry.fetchedAt).toISOString() : undefined;
}

/**
 * Fetches the official eval registry from the upstream repo.
 * Results are cached for 5 minutes to avoid repeated network calls.
 */
export async function fetchEvalRegistry(
  overrideUrl?: string,
): Promise<EvalRegistry> {
  const result = await fetchEvalRegistryWithStatus(overrideUrl);
  return result.registry;
}

export async function fetchEvalRegistryWithStatus(
  overrideUrl?: string,
): Promise<EvalRegistryFetchResult> {
  const now = Date.now();

  // Return cache if still valid
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      registry: cache.registry,
      source: 'cache',
      stale: false,
      fetchedAt: getFetchedAt(cache),
    };
  }

  // Deduplicate concurrent requests
  if (fetchPromise) {
    const registry = await fetchPromise;
    return {
      registry,
      source: 'network',
      stale: false,
      fetchedAt: getFetchedAt(cache),
    };
  }

  const url = overrideUrl ?? REGISTRY_URL;

  fetchPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch eval registry: ${response.status} ${response.statusText}`,
        );
      }

      const registry = parseEvalRegistry(await response.json());
      cache = { registry, fetchedAt: Date.now() };
      fetchPromise = null;
      return registry;
    } catch (err) {
      fetchPromise = null;
      throw err;
    }
  })();

  try {
    const registry = await fetchPromise;
    return {
      registry,
      source: 'network',
      stale: false,
      fetchedAt: getFetchedAt(cache),
    };
  } catch (err) {
    if (cache) {
      return {
        registry: cache.registry,
        source: 'cache',
        stale: true,
        fetchedAt: getFetchedAt(cache),
        error: err instanceof Error ? err.message : String(err),
      };
    }
    throw err;
  }
}

export function clearRegistryCache(): void {
  cache = null;
  fetchPromise = null;
}

function parseEvalRegistry(value: unknown): EvalRegistry {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    'updatedAt' in value &&
    'evals' in value &&
    typeof value.version === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.evals)
  ) {
    return value;
  }

  throw new Error('Invalid eval registry payload.');
}
