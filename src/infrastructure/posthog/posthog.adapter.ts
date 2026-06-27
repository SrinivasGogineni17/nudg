/**
 * PostHog analytics adapter implementing IAnalyticsService.
 * Wraps the posthog-react-native client and includes app version/build number
 * in all tracked events.
 */

import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

import type { IAnalyticsService, AnalyticsEvent } from '@/services/interfaces/analytics.service';
import { sanitizeTelemetryPayload } from '@/infrastructure/monitoring/telemetry-sanitizer';

/** PostHog client singleton — initialized via initPostHog(). */
let posthogClient: PostHog | null = null;

/** App metadata attached to every event. */
function getAppContext(): Record<string, string> {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    '1';

  return {
    app_version: version,
    app_build_number: buildNumber,
  };
}

/**
 * Converts a Record<string, unknown> to a PostHog-safe properties object
 * by filtering out values that aren't JSON-serializable primitives.
 */
function toSafeProperties(
  input?: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  if (!input) return {};

  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value;
    } else if (value !== undefined) {
      // Serialize complex values as JSON strings
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

/**
 * Initializes the PostHog client with API key and host from environment config.
 * Must be called once at app startup before tracking events.
 */
export async function initPostHog(): Promise<void> {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';

  if (!apiKey) {
    console.warn('[PostHog] Missing EXPO_PUBLIC_POSTHOG_API_KEY — analytics disabled');
    return;
  }

  posthogClient = new PostHog(apiKey, {
    host,
    flushInterval: 30000,
    flushAt: 20,
  });

  await posthogClient.ready();
}

/**
 * Returns the initialized PostHog client, or null if not yet initialized.
 * Exported for testing purposes.
 */
export function getPostHogClient(): PostHog | null {
  return posthogClient;
}

export class PostHogAnalyticsAdapter implements IAnalyticsService {
  /**
   * Tracks a named event with optional properties.
   * Includes app version and build number in all events.
   *
   * Fix 4: All properties pass through the PII sanitizer before transmission.
   * This prevents accidentally attached auth tokens, emails, or phone numbers
   * from leaking to the analytics service.
   */
  trackEvent(event: AnalyticsEvent): void {
    if (!posthogClient) return;

    // Fix 4: Sanitize all properties before they leave the device
    const rawProperties = {
      ...toSafeProperties(event.properties),
      ...getAppContext(),
      ...(event.timestamp ? { timestamp: new Date(event.timestamp).toISOString() } : {}),
    };

    const sanitizedProperties = sanitizeTelemetryPayload(rawProperties);

    posthogClient.capture(event.name, sanitizedProperties);
  }

  /**
   * Tracks a screen view navigation event.
   * Includes app version and build number.
   */
  trackScreenView(screenName: string): void {
    if (!posthogClient) return;

    posthogClient.screen(screenName, {
      ...getAppContext(),
    });
  }

  /**
   * Identifies a user with an anonymized user ID and optional traits.
   * Called after authentication to associate events with a user.
   */
  identify(userId: string, traits?: Record<string, unknown>): void {
    if (!posthogClient) return;

    posthogClient.identify(userId, {
      ...toSafeProperties(traits),
      ...getAppContext(),
    });
  }

  /**
   * Resets the PostHog identity on user logout.
   * Generates a new anonymous ID for subsequent events.
   */
  reset(): void {
    if (!posthogClient) return;

    posthogClient.reset();
  }
}
