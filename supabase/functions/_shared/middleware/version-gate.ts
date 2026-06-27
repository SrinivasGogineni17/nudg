/**
 * API Version Gate Middleware for Supabase Edge Functions.
 *
 * Edge Case 5 Fix: The 426 check must NOT apply to public/config endpoints,
 * otherwise the client can't fetch the version config that tells it to update.
 *
 * Exempt endpoints:
 * - GET /functions/v1/app-config (version config fetch)
 * - POST /functions/v1/appstore-webhook (Apple calls this, not the app)
 * - POST /functions/v1/twilio-webhook (Twilio calls this, not the app)
 * - POST /functions/v1/sms-queue-retry (scheduler calls this, not the app)
 *
 * Protected endpoints (require version check):
 * - POST /functions/v1/send-sms
 * - POST /functions/v1/decrypt-data
 * - POST /functions/v1/delete-customer
 */

/**
 * Compare two semantic version strings.
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

/**
 * Check if the client version in the request headers meets the minimum requirement.
 *
 * Returns a 426 Response if the client is too old, or null if the request should proceed.
 *
 * Bypasses:
 * - Internal service-to-service calls (service role key in auth header)
 * - Apple App Store reviewer account (identified by a special header)
 * - Requests without version header from scheduler/webhooks
 *
 * Usage in an edge function:
 * ```typescript
 * const versionReject = checkClientVersion(req);
 * if (versionReject) return versionReject;
 * // ... continue with normal handler logic
 * ```
 */
export function checkClientVersion(req: Request): Response | null {
  const minimumVersion = Deno.env.get('MINIMUM_CLIENT_VERSION');

  // If no minimum is set, all versions are allowed
  if (!minimumVersion) return null;

  const clientVersion = req.headers.get('X-App-Version');

  // If no version header is present, check if it's an internal/webhook call
  if (!clientVersion) {
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Internal service-to-service calls bypass version check
    if (authHeader.includes(serviceRoleKey)) {
      return null;
    }

    // External call without version header — reject
    return new Response(
      JSON.stringify({
        error: {
          code: 'UPGRADE_REQUIRED',
          message: 'Please update the Nudg app to the latest version.',
          minimumVersion,
        },
      }),
      {
        status: 426,
        headers: {
          'Content-Type': 'application/json',
          'Upgrade': 'nudg-app',
        },
      }
    );
  }

  // App Store Reviewer bypass: Apple's test account sends a known marker
  // Configure this via: supabase secrets set APP_REVIEW_BYPASS_TOKEN=<random-secret>
  const reviewBypassToken = Deno.env.get('APP_REVIEW_BYPASS_TOKEN');
  const clientBypassHeader = req.headers.get('X-Review-Bypass');
  if (reviewBypassToken && clientBypassHeader === reviewBypassToken) {
    return null;
  }

  // Compare versions
  if (compareSemver(clientVersion, minimumVersion) < 0) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'UPGRADE_REQUIRED',
          message: `App version ${clientVersion} is no longer supported. Minimum required: ${minimumVersion}`,
          minimumVersion,
          currentVersion: clientVersion,
        },
      }),
      {
        status: 426,
        headers: {
          'Content-Type': 'application/json',
          'Upgrade': 'nudg-app',
        },
      }
    );
  }

  // Version is acceptable
  return null;
}
