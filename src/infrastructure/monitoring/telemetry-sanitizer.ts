/**
 * Global Telemetry PII Sanitizer
 *
 * All telemetry events (Sentry + PostHog) pass through this before leaving
 * the device. Ensures no PII leaks to third-party analytics services.
 *
 * Architecture:
 * - Two-tier key blocklist: domain-specific + system/transport headers
 * - Pre-compiled regex for high-performance string scrubbing
 * - Recursive with depth guard for nested payloads
 * - Descriptive redaction tags for debugging which field was stripped
 */

import * as Sentry from '@sentry/react-native';

// ─── 1. Immutable Domain & System Blocklists ─────────────────────────────────

/** Domain-specific PII keys (exact match, case-sensitive). */
const DOMAIN_SENSITIVE_KEYS = new Set([
  'customerPhone',
  'customerEmail',
  'customerName',
  'feedbackText',
  'password',
  'token',
  'jwt',
  'phoneNumber',
  'phone_number',
  'customer_phone_encrypted',
  'customer_name_encrypted',
  'feedback_text_encrypted',
  'customer_phone_hash',
]);

/** Transport/system header keys (matched case-insensitively via toLowerCase). */
const GLOBAL_KEY_BLOCKLIST = new Set([
  'authorization',
  'x-api-key',
  'apikey',
  'cookie',
  'set-cookie',
  'access_token',
  'refresh_token',
  'auth_token',
  'service_role_key',
  'anon_key',
]);

// ─── 2. High-Performance Regex Patterns (Pre-compiled) ───────────────────────

/** Matches email addresses. */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Matches JWT tokens (three base64url segments). */
const JWT_REGEX = /eyJ[a-zA-Z0-9-_=]+\.eyJ[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_+/=]*/g;

/** Matches phone numbers in various formats (US/international). */
const PHONE_REGEX = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

/** Maximum recursion depth to prevent stack overflow on circular/deep objects. */
const MAX_DEPTH = 10;

// ─── 3. Core Data Scrubbing Engine ───────────────────────────────────────────

/**
 * Recursively sanitize a telemetry payload, stripping PII keys and values.
 *
 * @param obj - The data to sanitize (any type)
 * @param depth - Current recursion depth (internal, do not pass manually)
 * @returns A new sanitized object (never mutates the input)
 */
export function sanitizeTelemetryPayload(obj: any, depth: number = 0): any {
  if (obj === null || obj === undefined) return obj;

  // Depth guard — truncate deeply nested structures
  if (depth >= MAX_DEPTH) return '[TRUNCATED_DEPTH]';

  // Handle primitives with string-level regex scrubbing
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return obj
        .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
        .replace(JWT_REGEX, '[REDACTED_JWT]')
        .replace(PHONE_REGEX, '[REDACTED_PHONE]');
    }
    return obj;
  }

  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeTelemetryPayload(item, depth + 1));
  }

  // Handle Objects
  const sanitizedObj: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase();

      // Strict structural key evaluation — blocked keys get redacted entirely
      if (DOMAIN_SENSITIVE_KEYS.has(key) || GLOBAL_KEY_BLOCKLIST.has(lowerKey)) {
        sanitizedObj[key] = `[REDACTED_SENSITIVE_${key.toUpperCase()}]`;
      } else {
        sanitizedObj[key] = sanitizeTelemetryPayload(obj[key], depth + 1);
      }
    }
  }

  return sanitizedObj;
}

// ─── 4. Performance Metric Sampling ──────────────────────────────────────────

/**
 * Returns true 10% of the time — use for non-critical performance events.
 * Security and error events should ALWAYS be sent (bypass this check).
 */
export function shouldSamplePerformanceMetric(): boolean {
  return Math.random() < 0.1;
}

// ─── 5. Sentry beforeSend Integration ────────────────────────────────────────

/**
 * Sentry beforeSend hook that:
 * 1. Fingerprints SSL pinning errors to prevent PagerDuty alert storms
 * 2. Sanitizes all extra data and breadcrumbs before transmission
 *
 * Wire this into Sentry.init({ beforeSend: sentryBeforeSendConfig })
 */
export const sentryBeforeSendConfig: Sentry.ReactNativeOptions['beforeSend'] = (event) => {
  // Enforce issue fingerprinting for SSL Pinning failures
  // Groups all occurrences into a single issue → one PagerDuty alert max
  if (
    event.exception?.values?.some(
      (v) =>
        v.type?.includes('SSLPinningError') ||
        v.value?.includes('pinning') ||
        v.value?.includes('SSL')
    )
  ) {
    event.fingerprint = ['ssl-pinning-failure-group'];
  }

  // Apply deep sanitization before payload leaves the device
  if (event.extra) {
    event.extra = sanitizeTelemetryPayload(event.extra);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = sanitizeTelemetryPayload(event.breadcrumbs);
  }
  if (event.contexts) {
    event.contexts = sanitizeTelemetryPayload(event.contexts);
  }

  return event;
};

// ─── 6. Header Sanitization (for network breadcrumbs) ────────────────────────

/**
 * Sanitize HTTP headers for safe inclusion in telemetry breadcrumbs.
 */
export function sanitizeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {};

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (GLOBAL_KEY_BLOCKLIST.has(lowerKey)) {
      sanitized[key] = `[REDACTED_SENSITIVE_${key.toUpperCase()}]`;
    } else {
      sanitized[key] = sanitizeTelemetryPayload(value) as string;
    }
  }
  return sanitized;
}
