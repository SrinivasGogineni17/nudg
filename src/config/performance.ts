/**
 * Performance optimization configuration.
 *
 * Pillar 3: Performance & Optimization — App Launch Time (TTR)
 *
 * Key strategies for React Native/Expo TTR optimization:
 *
 * 1. LAZY SERVICE INITIALIZATION
 *    - Don't init Sentry/PostHog until after first render
 *    - Use InteractionManager.runAfterInteractions() for non-critical init
 *
 * 2. AVOID SYNCHRONOUS STORAGE READS ON LAUNCH
 *    - SecureStore reads are async — show a splash screen during session check
 *    - The auth loading state in useAuth handles this
 *
 * 3. MINIMIZE BUNDLE SIZE
 *    - Tree-shaking: Only import what you need from large libs
 *    - Conditional requires: Only load real services when not in mock mode
 *    - Already done in _layout.tsx with dynamic require()
 *
 * 4. HERMES ENGINE (ENABLED)
 *    - The project uses Hermes (expo.jsEngine = "hermes" in Podfile.properties.json)
 *    - Hermes provides:
 *      - Bytecode precompilation (faster startup)
 *      - Reduced memory footprint
 *      - Faster GC
 *
 * 5. REACT QUERY CACHE
 *    - Configure staleTime to avoid redundant API calls on screen focus
 *    - Use initialData from cache for instant screen renders
 */

import { InteractionManager } from 'react-native';

/**
 * Defers non-critical initialization until after the first meaningful render.
 * Use this for analytics, monitoring, and background sync setup.
 */
export function deferAfterInteractions(callback: () => void): void {
  InteractionManager.runAfterInteractions(() => {
    // Additional 100ms buffer to ensure paint is complete
    setTimeout(callback, 100);
  });
}

/**
 * React Query configuration optimized for mobile.
 * Applied in queryClientConfig.ts.
 */
export const QUERY_CACHE_CONFIG = {
  /** How long cached data is considered fresh (no refetch on mount). */
  staleTime: 5 * 60 * 1000, // 5 minutes

  /** How long unused cache entries are kept in memory. */
  gcTime: 30 * 60 * 1000, // 30 minutes

  /** Retry configuration for failed queries. */
  retry: 2,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10000),
};
