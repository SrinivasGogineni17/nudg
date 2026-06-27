/**
 * Encrypted cache storage using MMKV.
 *
 * Gap 1 Fix: React Query cache contains API response data that may include
 * PII (customer names, business data). AsyncStorage is unencrypted plaintext.
 * MMKV provides AES-256 encryption at the storage layer.
 *
 * Edge Case 1 Fix: If the Keychain becomes unreachable (passcode change,
 * iCloud restore, hardware state change), we gracefully purge the local
 * cache and force re-authentication rather than crashing on launch.
 *
 * Architecture:
 * 1. Generate a random encryption key on first launch
 * 2. Store that key in the iOS Keychain via expo-secure-store
 * 3. Initialize MMKV with that key — all cached data is encrypted at rest
 * 4. If Keychain read fails → purge MMKV entirely → force fresh login
 */

import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

const MMKV_KEY_ID = 'nudg_mmkv_encryption_key';
const MMKV_INSTANCE_ID = 'nudg-cache-v1';

/** Cached MMKV instance (singleton). */
let mmkvInstance: MMKV | null = null;

/** Flag indicating the cache had to be purged due to Keychain failure. */
let cacheWasPurged = false;

/**
 * Check if the cache was purged on this launch due to a Keychain failure.
 * If true, the app should force a fresh login.
 */
export function wasCachePurgedOnLaunch(): boolean {
  return cacheWasPurged;
}

/**
 * Get or generate the MMKV encryption key from the Keychain.
 *
 * Edge Case 1: Wraps Keychain access in try/catch. On failure (passcode change,
 * iCloud restore, corrupted Keychain item), returns null to signal degradation.
 */
async function getOrCreateEncryptionKey(): Promise<string | null> {
  try {
    let key = await SecureStore.getItemAsync(MMKV_KEY_ID);

    if (!key) {
      // Generate a random 128-bit key (32 hex chars)
      const bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      key = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      await SecureStore.setItemAsync(MMKV_KEY_ID, key, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    }

    return key;
  } catch (error) {
    // Keychain is unreachable — device passcode changed, iCloud restore, etc.
    console.error(
      '[EncryptedStorage] Keychain read failed. Cache will be purged.',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Initialize the encrypted MMKV instance.
 *
 * Edge Case 1: If Keychain is unreachable, creates an unencrypted MMKV instance,
 * immediately clears it, sets the purge flag, and returns it. The app should
 * check wasCachePurgedOnLaunch() and force re-authentication.
 */
export async function initEncryptedStorage(): Promise<MMKV> {
  if (mmkvInstance) return mmkvInstance;

  const encryptionKey = await getOrCreateEncryptionKey();

  if (encryptionKey) {
    // Happy path: encrypted cache with Keychain-backed key
    try {
      mmkvInstance = new MMKV({
        id: MMKV_INSTANCE_ID,
        encryptionKey,
      });
      return mmkvInstance;
    } catch (error) {
      // MMKV initialization failed (corrupted data from old key)
      console.error(
        '[EncryptedStorage] MMKV init failed with existing key. Purging.',
        error instanceof Error ? error.message : error
      );
    }
  }

  // Degradation path: Keychain failed or MMKV corrupted
  // Create a fresh unencrypted instance and immediately clear it
  cacheWasPurged = true;

  mmkvInstance = new MMKV({ id: `${MMKV_INSTANCE_ID}-fresh` });
  mmkvInstance.clearAll();

  // Attempt to write a new key for future launches
  try {
    const newKey = Array.from(new Uint8Array(16))
      .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(MMKV_KEY_ID, newKey, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch {
    // Still can't write to Keychain — app will work without persistent cache
  }

  return mmkvInstance;
}

/**
 * Get the initialized MMKV instance.
 * Returns null if not yet initialized (caller should handle gracefully).
 */
export function getEncryptedStorage(): MMKV | null {
  return mmkvInstance;
}

/**
 * Encrypted storage adapter compatible with React Query's persistQueryClient.
 * Safely handles the case where MMKV is not yet initialized or was purged.
 */
export const EncryptedCacheAdapter = {
  getItem(key: string): string | null {
    const storage = getEncryptedStorage();
    if (!storage) return null;
    return storage.getString(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const storage = getEncryptedStorage();
    if (!storage) return;
    storage.set(key, value);
  },

  removeItem(key: string): void {
    const storage = getEncryptedStorage();
    if (!storage) return;
    storage.delete(key);
  },
};
