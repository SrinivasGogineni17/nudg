/**
 * Offline-first caching strategy using React Query + encrypted MMKV persistence.
 *
 * Gap 1 Fix: Cache is now stored in MMKV with AES-256 encryption.
 * The encryption key lives in the iOS Keychain (expo-secure-store).
 * No PII ever touches unencrypted disk storage.
 *
 * Strategy:
 * 1. React Query serves cached data immediately (staleTime-based)
 * 2. Background refetch updates the cache silently
 * 3. On network failure, encrypted cached data remains accessible
 * 4. Cache is persisted to MMKV (encrypted) for cold starts
 * 5. Mutations are optimistic — update UI immediately, sync later
 */

import { QueryClient } from '@tanstack/react-query';
import { EncryptedCacheAdapter } from './encrypted-storage';

const CACHE_KEY = 'nudg_rq_cache';

/**
 * Persist the React Query cache to encrypted MMKV storage.
 * Call this on app background (AppState change) and periodically.
 */
export function persistQueryCache(queryClient: QueryClient): void {
  try {
    const cache = queryClient.getQueryCache().getAll();
    const serializable = cache
      .filter((query) => query.state.status === 'success' && query.state.data != null)
      .map((query) => ({
        queryKey: query.queryKey,
        data: query.state.data,
        dataUpdatedAt: query.state.dataUpdatedAt,
      }));

    EncryptedCacheAdapter.setItem(CACHE_KEY, JSON.stringify(serializable));
  } catch {
    // Cache persistence is best-effort — don't crash the app
  }
}

/**
 * Restore the React Query cache from encrypted MMKV on cold start.
 * Provides instant data display without network round-trip.
 */
export function restoreQueryCache(queryClient: QueryClient): void {
  try {
    const cached = EncryptedCacheAdapter.getItem(CACHE_KEY);
    if (!cached) return;

    const entries = JSON.parse(cached) as Array<{
      queryKey: unknown[];
      data: unknown;
      dataUpdatedAt: number;
    }>;

    // Only restore entries that are less than 30 minutes old
    const maxAge = 30 * 60 * 1000;
    const now = Date.now();

    for (const entry of entries) {
      if (now - entry.dataUpdatedAt < maxAge) {
        queryClient.setQueryData(entry.queryKey, entry.data, {
          updatedAt: entry.dataUpdatedAt,
        });
      }
    }
  } catch {
    // Corrupted cache — clear it
    EncryptedCacheAdapter.removeItem(CACHE_KEY);
  }
}

/**
 * Clear all cached data. Call on logout.
 */
export function clearQueryCache(queryClient: QueryClient): void {
  queryClient.clear();
  EncryptedCacheAdapter.removeItem(CACHE_KEY);
}
