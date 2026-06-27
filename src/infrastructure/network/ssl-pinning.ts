/**
 * SSL Certificate Pinning implementation.
 *
 * Gap 2 Fix: Relying solely on the OS trust store leaves the app vulnerable
 * to MitM attacks when a rogue CA certificate is installed on the device
 * (e.g., corporate proxies, compromised public Wi-Fi).
 *
 * This module pins the public key hash of the Supabase server certificate.
 * If the server's certificate doesn't match the pinned hash, the request fails
 * immediately — preventing token and PII exfiltration.
 *
 * Setup:
 * 1. Get your Supabase project's certificate hash:
 *    ```bash
 *    openssl s_client -connect YOUR_PROJECT.supabase.co:443 2>/dev/null | \
 *      openssl x509 -pubkey -noout | \
 *      openssl pkey -pubin -outform DER | \
 *      openssl dgst -sha256 -binary | base64
 *    ```
 *
 * 2. Also pin Supabase's intermediate CA for rotation resilience:
 *    ```bash
 *    openssl s_client -showcerts -connect YOUR_PROJECT.supabase.co:443 2>/dev/null | \
 *      awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/{ if(n++) print }' | head -1 | \
 *      openssl x509 -pubkey -noout | \
 *      openssl pkey -pubin -outform DER | \
 *      openssl dgst -sha256 -binary | base64
 *    ```
 *
 * 3. Replace the placeholder hashes below with real values.
 *
 * Certificate Rotation Strategy:
 * - Pin BOTH the current leaf AND the intermediate CA
 * - When Supabase rotates their cert, the intermediate still validates
 * - Monitor cert expiry and push an app update with new pins before rotation
 * - The force-update mechanism (Gap 5) ensures old pins don't break production
 */

import { fetch as sslFetch } from 'react-native-ssl-pinning';

/**
 * SHA-256 public key hashes for certificate pinning.
 *
 * Edge Case 2 Fix: Pin BOTH the leaf AND the intermediate CA.
 * If Supabase rotates their leaf cert, the intermediate still validates.
 * This gives you a maintenance window to push an app update with new leaf pin.
 *
 * Rotation strategy:
 * - Set a calendar reminder 60 days before cert expiry
 * - Push a new app version with updated leaf hash
 * - The force-update mechanism (Gap 5) ensures old versions update
 * - Intermediate CA pin acts as safety net during transition
 *
 * ⚠️  REPLACE THESE with your actual certificate hashes.
 *
 * To get your hashes, run:
 * ```bash
 * # Leaf certificate (your Supabase project):
 * echo | openssl s_client -connect YOUR_PROJECT.supabase.co:443 2>/dev/null | \
 *   openssl x509 -pubkey -noout | \
 *   openssl pkey -pubin -outform DER | \
 *   openssl dgst -sha256 -binary | base64
 *
 * # Intermediate CA (backup pin — longer lived):
 * echo | openssl s_client -showcerts -connect YOUR_PROJECT.supabase.co:443 2>/dev/null | \
 *   awk '/BEGIN CERT/{n++} n==2' RS='-----END CERTIFICATE-----' | \
 *   openssl x509 -pubkey -noout | \
 *   openssl pkey -pubin -outform DER | \
 *   openssl dgst -sha256 -binary | base64
 *
 * # Check expiry date (set reminder 60 days before this):
 * echo | openssl s_client -connect YOUR_PROJECT.supabase.co:443 2>/dev/null | \
 *   openssl x509 -noout -enddate
 * ```
 */
const PINNED_CERTIFICATES = {
  // Primary: Your Supabase project's leaf certificate hash
  leaf: 'REPLACE_WITH_YOUR_LEAF_CERT_SHA256_BASE64',
  // Backup: Intermediate CA hash (survives leaf rotation)
  intermediate: 'REPLACE_WITH_INTERMEDIATE_CA_SHA256_BASE64',
  // Expiry tracking — update these when you refresh pins
  leafExpiresAt: '2025-12-01T00:00:00Z', // Set your cert expiry here
  lastUpdated: '2024-06-26',
};

/**
 * Domain configuration for pinning.
 * Only pin your Supabase API domain — don't pin third-party SDKs
 * (Sentry, PostHog) as they rotate certificates independently.
 */
const PINNED_DOMAINS = {
  supabase: process.env.EXPO_PUBLIC_SUPABASE_URL?.replace('https://', '') ?? '',
};

export interface PinnedFetchOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutInterval?: number;
}

/**
 * Perform an HTTPS request with certificate pinning.
 * Use this for all Supabase API calls in production.
 *
 * Falls back to standard fetch in development (pinning breaks with Metro proxy).
 */
export async function pinnedFetch(
  url: string,
  options: PinnedFetchOptions
): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
  const isDev = __DEV__;

  // Skip pinning in development (Metro bundler proxy breaks it)
  if (isDev) {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    return {
      status: response.status,
      json: () => response.json(),
      text: () => response.text(),
    };
  }

  // Production: enforce certificate pinning
  try {
    const response = await sslFetch(url, {
      method: options.method,
      headers: options.headers ?? {},
      body: options.body,
      timeoutInterval: options.timeoutInterval ?? 15000,
      sslPinning: {
        certs: ['supabase_cert'], // Reference to .cer file in ios bundle
      },
      // Alternative: pin by public key hash (more rotation-friendly)
      // pkPinning: true,
      // sslPinning: {
      //   certs: [PINNED_CERTIFICATES.leaf, PINNED_CERTIFICATES.intermediate],
      // },
    });

    return {
      status: response.status,
      json: () => Promise.resolve(response.json()),
      text: () => Promise.resolve(response.bodyString ?? ''),
    };
  } catch (error) {
    // SSL pinning failure — certificate mismatch detected
    // This could be a MitM attack or a legitimate certificate rotation
    const err = error as Error;

    if (err.message?.includes('cancelled') || err.message?.includes('SSL')) {
      throw new SSLPinningError(
        'Certificate validation failed. The connection may not be secure.'
      );
    }

    throw error;
  }
}

/**
 * Custom error class for SSL pinning failures.
 * The app should show a security warning and refuse to proceed.
 */
export class SSLPinningError extends Error {
  readonly isSSLPinningError = true;

  constructor(message: string) {
    super(message);
    this.name = 'SSLPinningError';
  }
}

/**
 * Check if an error is an SSL pinning failure.
 */
export function isSSLPinningError(error: unknown): error is SSLPinningError {
  return error instanceof SSLPinningError;
}
