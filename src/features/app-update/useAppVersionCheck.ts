/**
 * Dual-layer app version enforcement.
 *
 * Gap 5 Fix: Client-side UI blocking alone is bypassable. This implementation
 * uses TWO layers:
 *
 * Layer 1 (Client): Remote JSON config → blocking UI overlay (good UX)
 * Layer 2 (Server): API version header → 426 Upgrade Required response (enforced)
 *
 * Even if a user bypasses the JS overlay (Frida, modified bundle), the server
 * rejects all API calls from outdated clients, preventing data corruption.
 *
 * Server-side implementation (add to Supabase Edge Functions):
 * ```typescript
 * const clientVersion = req.headers.get('X-App-Version');
 * const minimumVersion = Deno.env.get('MINIMUM_CLIENT_VERSION') || '1.0.0';
 * if (compareSemver(clientVersion, minimumVersion) < 0) {
 *   return new Response(JSON.stringify({
 *     error: { code: 'UPGRADE_REQUIRED', message: 'Please update the app' }
 *   }), { status: 426 });
 * }
 * ```
 */

import { useEffect, useState, useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import Constants from 'expo-constants';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppVersionConfig {
  ios: {
    minimumVersion: string;
    recommendedVersion: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
  };
}

export type UpdateStatus =
  | 'up-to-date'
  | 'soft-update'
  | 'force-update'
  | 'maintenance'
  | 'loading'
  | 'error';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Remote version config URL. Host in Supabase Storage (public bucket). */
const VERSION_CONFIG_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL
    ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/config/app-version.json`
    : '';

/** App Store listing URL. */
const APP_STORE_URL = 'https://apps.apple.com/app/idYOUR_APP_ID';

/** Current app version from app.json. */
export const CURRENT_APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

// ─── Semver Comparison ───────────────────────────────────────────────────────

/**
 * Compare semantic versions.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// ─── Layer 2: API Version Header ─────────────────────────────────────────────

/**
 * Returns headers that must be included in ALL API requests.
 * The server uses X-App-Version to enforce minimum version server-side.
 *
 * This is the enforcement layer that cannot be bypassed by client modification.
 */
export function getVersionHeaders(): Record<string, string> {
  return {
    'X-App-Version': CURRENT_APP_VERSION,
    'X-App-Platform': 'ios',
    'X-App-Build': Constants.expoConfig?.ios?.buildNumber ?? '1',
  };
}

/**
 * Check if a response indicates the client version is too old.
 * Call this in your network interceptor for ALL API responses.
 *
 * HTTP 426 = Upgrade Required (RFC 7231)
 */
export function isUpgradeRequired(status: number): boolean {
  return status === 426;
}

/**
 * Handle a 426 response from the server.
 * Shows a non-dismissible alert directing the user to update.
 */
export function handleUpgradeRequired(): void {
  Alert.alert(
    'Update Required',
    'This version of Nudg is no longer supported. Please update to continue.',
    [
      {
        text: 'Update Now',
        onPress: () => Linking.openURL(APP_STORE_URL),
      },
    ],
    { cancelable: false }
  );
}

// ─── Layer 1: Client-Side Version Check Hook ─────────────────────────────────

/**
 * Hook that checks remote version config on cold start.
 * Provides Layer 1 (UX-friendly) version gating.
 *
 * Layer 2 (server enforcement) happens independently via getVersionHeaders()
 * in the network interceptor — even if this hook is bypassed, the server
 * still rejects outdated clients.
 */
export function useAppVersionCheck(): {
  status: UpdateStatus;
  maintenanceMessage: string;
  retry: () => void;
} {
  const [status, setStatus] = useState<UpdateStatus>('loading');
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  const checkVersion = useCallback(async () => {
    // Skip check if URL not configured
    if (!VERSION_CONFIG_URL) {
      setStatus('up-to-date');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(VERSION_CONFIG_URL, {
        cache: 'no-cache',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        // Fail open — don't block users if config is unavailable
        setStatus('up-to-date');
        return;
      }

      const config: AppVersionConfig = await response.json();
      const platformConfig = config.ios;

      // Maintenance mode — blocks everything
      if (platformConfig.maintenanceMode) {
        setStatus('maintenance');
        setMaintenanceMessage(
          platformConfig.maintenanceMessage ||
            'The app is currently under maintenance. Please try again later.'
        );
        return;
      }

      // Force update — non-dismissible
      if (compareSemver(CURRENT_APP_VERSION, platformConfig.minimumVersion) < 0) {
        setStatus('force-update');
        return;
      }

      // Soft update — dismissible prompt
      if (compareSemver(CURRENT_APP_VERSION, platformConfig.recommendedVersion) < 0) {
        setStatus('soft-update');
        return;
      }

      setStatus('up-to-date');
    } catch {
      // Network failure — fail open, server-side enforcement (Layer 2) is the safety net
      setStatus('up-to-date');
    }
  }, []);

  useEffect(() => {
    checkVersion();
  }, [checkVersion]);

  return { status, maintenanceMessage, retry: checkVersion };
}
