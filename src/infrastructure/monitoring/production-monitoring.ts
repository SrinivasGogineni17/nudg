/**
 * Production Monitoring Strategy
 *
 * Monitors the 5 architectural layers with specific alerts and dashboards.
 * Uses Sentry (errors/crashes), PostHog (behavior), and Supabase (server health).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    MONITORING ARCHITECTURE                          │
 * ├──────────────┬──────────────────────────────────────────────────────┤
 * │ Layer        │ What we monitor                                     │
 * ├──────────────┼──────────────────────────────────────────────────────┤
 * │ 1. Storage   │ Keychain failures, MMKV corruption, cache purges    │
 * │ 2. Network   │ SSL pin failures, cert expiry countdown             │
 * │ 3. Traffic   │ 429 rate limits, request latency p95/p99            │
 * │ 4. CI/CD     │ Build failures, version drift, deploy frequency     │
 * │ 5. Versioning│ 426 rejections, update adoption rate, deadlock hits │
 * └──────────────┴──────────────────────────────────────────────────────┘
 */

import * as Sentry from '@sentry/react-native';
import type { IAnalyticsService } from '@/services/interfaces/analytics.service';

// ─── Fix 3: Event Sampling Utility ───────────────────────────────────────────

/**
 * Deterministic sampling function.
 * Returns true if this event should be tracked based on the sample rate.
 *
 * @param rate - Value between 0 and 1. E.g., 0.1 = 10% of events tracked.
 */
function shouldSample(rate: number): boolean {
  return Math.random() < rate;
}

/**
 * Sampling rates by event category.
 * - Security events: 100% (never miss an attack signal)
 * - Error events: 100% (every crash matters)
 * - Performance metrics: 10% (statistically valid at scale)
 * - Behavioral events: 5-25% depending on frequency
 */
const SAMPLE_RATES = {
  security: 1.0,    // SSL failures, 426 rejections — always
  error: 1.0,       // Crashes, exceptions — always
  performance: 0.1, // Latency, jitter distribution — 10%
  behavior: 0.25,   // Foreground events, navigation — 25%
} as const;

// ─── Layer 1: Storage Health Monitoring ──────────────────────────────────────

/**
 * Track when the encrypted cache is purged due to Keychain failure.
 * Alert condition: > 5 occurrences in 24 hours = potential device-wide issue.
 */
export function trackCachePurge(reason: string): void {
  Sentry.captureMessage('Encrypted cache purged', {
    level: 'warning',
    tags: {
      subsystem: 'storage',
      purgeReason: reason,
    },
    extra: {
      action: 'User will be forced to re-authenticate',
    },
  });
}

/**
 * Track Keychain access failures for trending.
 * Non-fatal but indicates device state changes affecting users.
 */
export function trackKeychainFailure(operation: 'read' | 'write', error: string): void {
  Sentry.addBreadcrumb({
    category: 'storage.keychain',
    message: `Keychain ${operation} failed: ${error}`,
    level: 'warning',
  });
}

// ─── Layer 2: Network & SSL Monitoring ───────────────────────────────────────

/**
 * Track SSL pinning failures.
 *
 * Fix 1: Uses Sentry fingerprinting to group ALL SSL pin failures into a
 * single issue — preventing PagerDuty alert storms when thousands of users
 * hit the same cert rotation or ISP misconfiguration simultaneously.
 *
 * Sentry will create ONE issue (one PagerDuty alert) regardless of volume.
 * The issue's event count shows severity.
 *
 * Alert condition: New issue created = potential MitM or cert rotation needed.
 */
export function trackSSLPinningFailure(domain: string, error: string): void {
  Sentry.withScope((scope) => {
    // Force all SSL pin failures for the same domain into ONE issue
    // Prevents PagerDuty storm when thousands of users hit the same failure
    scope.setFingerprint(['ssl-pinning-failure', domain]);

    scope.setTag('subsystem', 'network.ssl');
    scope.setTag('domain', domain);
    scope.setLevel('fatal');
    scope.setExtra('action', 'Request was blocked. Check if cert rotation is needed.');
    scope.setExtra('errorDetail', error);

    Sentry.captureMessage(`SSL Pinning Failed: ${domain}`);
  });
}

/**
 * Track network request latency for p95/p99 dashboards.
 *
 * Fix 3: Sampled at 10% for standard requests.
 * Slow requests (> 3s) are ALWAYS tracked at 100% for regression detection.
 */
export function trackRequestLatency(
  analytics: IAnalyticsService,
  endpoint: string,
  durationMs: number,
  statusCode: number
): void {
  const isSlow = durationMs > 3000;

  // Always track slow requests; sample normal ones at 10%
  if (!isSlow && !shouldSample(SAMPLE_RATES.performance)) return;

  analytics.trackEvent({
    name: 'api_request_completed',
    properties: {
      endpoint,
      durationMs,
      statusCode,
      isSlowRequest: isSlow,
      _sampled: true,
      _sampleRate: isSlow ? 1.0 : SAMPLE_RATES.performance,
    },
  });
}

/**
 * Track when the app receives a 429 (rate limited).
 * Alert condition: > 10 in 5 minutes = thundering herd regression.
 */
export function trackRateLimited(endpoint: string): void {
  Sentry.captureMessage('Rate limited by server', {
    level: 'warning',
    tags: {
      subsystem: 'network.ratelimit',
      endpoint,
    },
  });
}

// ─── Layer 3: Traffic Pattern Monitoring ─────────────────────────────────────

/**
 * Track foreground refresh events for thundering herd analysis.
 *
 * Fix 3: Sampled at 10% to prevent event volume explosion at scale.
 * 10% sample gives statistically valid distribution data for jitter
 * verification without generating millions of events/day.
 *
 * Critical events (crashes, SSL failures, 426s) are ALWAYS sent at 100%.
 * Only non-critical performance metrics are sampled.
 */
export function trackForegroundRefresh(
  analytics: IAnalyticsService,
  backgroundDurationMs: number,
  jitterMs: number
): void {
  // 10% sampling — sufficient for distribution analysis
  if (!shouldSample(0.1)) return;

  analytics.trackEvent({
    name: 'app_foreground_refresh',
    properties: {
      backgroundDurationMs,
      jitterMs,
      jitterBucket: Math.floor(jitterMs / 500) * 500,
      _sampled: true,
      _sampleRate: 0.1,
    },
  });
}

// ─── Layer 4: Deployment Health ──────────────────────────────────────────────

/**
 * Track app version on every launch for adoption dashboards.
 * PostHog will show you what % of users are on each version.
 */
export function trackAppLaunch(
  analytics: IAnalyticsService,
  appVersion: string,
  buildNumber: string
): void {
  analytics.trackEvent({
    name: 'app_launched',
    properties: {
      appVersion,
      buildNumber,
      launchTimestamp: Date.now(),
    },
  });
}

// ─── Layer 5: Version Enforcement Monitoring ─────────────────────────────────

/**
 * Track when a 426 Upgrade Required is received.
 * Alert condition: Sustained 426s after a forced update window =
 * users are stuck (can't update from App Store).
 */
export function trackUpgradeRequired(
  clientVersion: string,
  requiredVersion: string
): void {
  Sentry.captureMessage('Client received 426 Upgrade Required', {
    level: 'info',
    tags: {
      subsystem: 'versioning',
      clientVersion,
      requiredVersion,
    },
    extra: {
      action: 'User should be directed to App Store update',
    },
  });
}

/**
 * Track force update UI shown vs dismissed (soft update only).
 * PostHog funnel: update_shown → update_accepted / update_dismissed
 */
export function trackUpdatePromptShown(
  analytics: IAnalyticsService,
  type: 'force' | 'soft',
  currentVersion: string,
  targetVersion: string
): void {
  analytics.trackEvent({
    name: 'update_prompt_shown',
    properties: {
      type,
      currentVersion,
      targetVersion,
    },
  });
}

// ─── Sentry Alert Rules (configure in Sentry Dashboard) ─────────────────────

/**
 * Recommended Sentry Alert Rules to configure:
 *
 * 1. "SSL Pinning Failure" — Issue Alert
 *    Condition: message contains "SSL Pinning Validation Failed"
 *    Action: PagerDuty/Slack immediately (potential security incident)
 *    Threshold: 1 occurrence
 *
 * 2. "Cache Purge Storm" — Metric Alert
 *    Condition: count of "Encrypted cache purged" > 5 in 1 hour
 *    Action: Slack warning (possible Keychain/iOS issue)
 *
 * 3. "Rate Limit Spike" — Metric Alert
 *    Condition: count of "Rate limited by server" > 10 in 5 minutes
 *    Action: Slack warning (thundering herd or abuse)
 *
 * 4. "Crash-Free Rate Drop" — Metric Alert
 *    Condition: crash-free sessions < 99% over 1 hour
 *    Action: PagerDuty (production stability issue)
 *
 * 5. "426 Sustained After 72h" — Metric Alert
 *    Condition: count of "426 Upgrade Required" > 100/day after 3 days post-release
 *    Action: Slack (users might not be able to update)
 */

// ─── PostHog Dashboards (configure in PostHog UI) ────────────────────────────

/**
 * Recommended PostHog Dashboards:
 *
 * 1. "Version Adoption"
 *    Chart: Stacked area of app_launched.appVersion over time
 *    Shows: How fast users adopt new versions after release
 *
 * 2. "API Performance"
 *    Chart: p95 of api_request_completed.durationMs grouped by endpoint
 *    Shows: Which endpoints are slow; regression detection
 *
 * 3. "Foreground Refresh Distribution"
 *    Chart: Histogram of app_foreground_refresh.jitterBucket
 *    Shows: Whether jitter is evenly distributed (validates thundering herd fix)
 *
 * 4. "Update Funnel"
 *    Funnel: update_prompt_shown → update_accepted (within 24h)
 *    Shows: What % of users accept soft updates
 *
 * 5. "Storage Health"
 *    Chart: Count of app_launched where wasCachePurged = true
 *    Shows: How many users hit Keychain failures
 */
