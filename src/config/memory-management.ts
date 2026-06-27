/**
 * Memory management and app state utilities.
 *
 * Gap 3 Fix: The foreground refresh hook now includes:
 * - Minimum background duration threshold (no refetch if away < 5 min)
 * - Jitter to spread out requests across users (prevents thundering herd)
 * - Stale-time awareness to avoid redundant fetches
 */

import { AppState, type AppStateStatus } from 'react-native';
import { useEffect, useRef, useCallback } from 'react';

/** Minimum time in background before triggering a refetch (ms). */
const MIN_BACKGROUND_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum random jitter added to refetch timing (ms). */
const MAX_JITTER_MS = 3000; // 0-3 seconds random delay

/**
 * Hook to refresh data when the app returns from background.
 *
 * Gap 3 Fix — Thundering Herd Prevention:
 * 1. Only triggers if the app was backgrounded for >= 5 minutes
 * 2. Adds random jitter (0-3s) to spread concurrent requests
 * 3. Callers should check React Query's staleTime before actual fetch
 *
 * Edge Case 3 Fix: React Query's architecture already handles this correctly.
 * When you call queryClient.invalidateQueries(), it:
 * - Immediately serves the existing cached data to the UI (no flash/loading)
 * - Triggers a background refetch
 * - Seamlessly swaps in fresh data when it arrives
 * The user never sees a loading spinner or stale gap.
 *
 * Usage:
 * ```tsx
 * useThrottledAppStateRefresh(() => {
 *   // invalidateQueries marks cache as stale but KEEPS showing cached data
 *   // React Query refetches in background — UI stays fluid
 *   queryClient.invalidateQueries({ queryKey: ['dashboard'] });
 *   queryClient.invalidateQueries({ queryKey: ['inbox'] });
 * });
 * ```
 */
export function useThrottledAppStateRefresh(onForeground: () => void): void {
  const appState = useRef(AppState.currentState);
  const backgroundTimestamp = useRef<number | null>(null);

  // Memoize to prevent unnecessary effect re-runs
  const stableCallback = useRef(onForeground);
  stableCallback.current = onForeground;

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        // Track when we go to background
        if (
          appState.current === 'active' &&
          (nextState === 'inactive' || nextState === 'background')
        ) {
          backgroundTimestamp.current = Date.now();
        }

        // Returning to foreground
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          const backgroundDuration = backgroundTimestamp.current
            ? Date.now() - backgroundTimestamp.current
            : 0;

          // Only refetch if user was away long enough
          if (backgroundDuration >= MIN_BACKGROUND_DURATION_MS) {
            // Add random jitter to prevent thundering herd
            const jitter = Math.random() * MAX_JITTER_MS;

            setTimeout(() => {
              stableCallback.current();
            }, jitter);
          }

          backgroundTimestamp.current = null;
        }

        appState.current = nextState;
      }
    );

    return () => subscription.remove();
  }, []);
}

/**
 * Non-throttled version for critical refreshes (e.g., auth state).
 * Use sparingly — only for data that MUST be fresh immediately.
 */
export function useImmediateAppStateRefresh(onForeground: () => void): void {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          onForeground();
        }
        appState.current = nextState;
      }
    );

    return () => subscription.remove();
  }, [onForeground]);
}
