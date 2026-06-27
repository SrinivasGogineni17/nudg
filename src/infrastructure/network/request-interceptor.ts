/**
 * Network request interceptor for observability and error resilience.
 *
 * Provides:
 * 1. Automatic breadcrumb logging for all API requests (non-PII)
 * 2. Automatic 401 detection with token refresh retry
 * 3. 5xx error classification with exponential backoff
 * 4. Request/response timing for performance monitoring
 * 5. Gap 5: X-App-Version header injection + 426 handling (server-side force update)
 *
 * Pillar 2: Stability & Observability
 */

import { supabase } from '@/infrastructure/supabase/client';
import {
  getVersionHeaders,
  isUpgradeRequired,
  handleUpgradeRequired,
} from '@/features/app-update/useAppVersionCheck';

/** Maximum retry attempts for transient failures. */
const MAX_RETRIES = 2;

/** Base delay for exponential backoff (ms). */
const BASE_DELAY_MS = 1000;

/** Fields to redact from breadcrumb data. */
const REDACTED_HEADERS = ['authorization', 'apikey'];

interface RequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  /** Monitoring service for breadcrumbs (injected to avoid circular deps). */
  onBreadcrumb?: (breadcrumb: {
    category: string;
    message: string;
    level: string;
    data?: Record<string, unknown>;
  }) => void;
}

interface InterceptedResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  durationMs: number;
}

/**
 * Sanitize headers for logging — redacts auth tokens.
 */
function sanitizeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADERS.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Sleep utility for backoff delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a fetch request with automatic retry, token refresh, and breadcrumb logging.
 */
export async function interceptedFetch(
  options: RequestOptions
): Promise<InterceptedResponse> {
  const { url, method, headers, body, onBreadcrumb } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();

    try {
      // Gap 5: Inject version headers into every request
      const enrichedHeaders = {
        ...headers,
        ...getVersionHeaders(),
      };

      const response = await fetch(url, {
        method,
        headers: enrichedHeaders,
        body,
      });

      const durationMs = Date.now() - startTime;
      const responseData = await response.json().catch(() => null);

      // Log breadcrumb (non-PII)
      onBreadcrumb?.({
        category: 'network',
        message: `${method} ${new URL(url).pathname} → ${response.status}`,
        level: response.ok ? 'info' : 'warning',
        data: {
          url: new URL(url).pathname, // Path only, no query params (may contain PII)
          method,
          statusCode: response.status,
          durationMs,
          attempt,
        },
      });

      // Gap 5: Handle 426 Upgrade Required — server-side force update enforcement
      if (isUpgradeRequired(response.status)) {
        handleUpgradeRequired();
        throw new Error('App version too old. Update required.');
      }

      // Handle 401: attempt token refresh once
      if (response.status === 401 && attempt === 0) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError) {
          // Retry with new token — the Supabase client will use the refreshed session
          continue;
        }
        // Refresh failed — return the 401 as-is (app will redirect to login)
      }

      // Handle 5xx: retry with exponential backoff
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      return {
        status: response.status,
        data: responseData,
        headers: Object.fromEntries(response.headers.entries()),
        durationMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      onBreadcrumb?.({
        category: 'network',
        message: `${method} ${new URL(url).pathname} → FAILED (attempt ${attempt + 1})`,
        level: 'error',
        data: {
          url: new URL(url).pathname,
          method,
          error: lastError.message,
          attempt,
        },
      });

      // Network errors: retry with backoff
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError ?? new Error('Request failed after all retries');
}
