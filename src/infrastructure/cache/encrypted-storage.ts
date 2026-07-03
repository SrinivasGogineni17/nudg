/**
 * Encrypted cache storage using MMKV v4.
 *
 * Uses createMMKV() factory with AES-256 encryption.
 * Encryption key is stored in the iOS Keychain via expo-secure-store.
 *
 * Edge Case 1: If Keychain becomes unreachable (passcode change, iCloud restore),
 * gracefully purges the cache and forces re-authentication.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';
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
 * Returns null if Keychain is unreachable.
 */
async function getOrCreateEncryptionKey(): Promise<string | null> {
  try {
    let key = await SecureStore.getItemAsync(MMKV_KEY_ID);

    if (!key) {
      // Generate a random 32-byte key (for AES-256)
      const bytes = new Uint8Array(32);
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
    console.error(
      '[EncryptedStorage] Keychain read failed. Cache will be purged.',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Initialize the encrypted MMKV instance.
 * If Keychain is unreachable, creates a fresh unencrypted instance and purges it.
 */
export async function initEncryptedStorage(): Promise<MMKV> {
  if (mmkvInstance) return mmkvInstance;

  const encryptionKey = await getOrCreateEncryptionKey();

  if (encryptionKey) {
    try {
      mmkvInstance = createMMKV({
        id: MMKV_INSTANCE_ID,
        encryptionKey,
        encryptionType: 'AES-256',
      });
      return mmkvInstance;
    } catch (error) {
      console.error(
        '[EncryptedStorage] MMKV init failed with existing key. Purging.',
        error instanceof Error ? error.message : error
      );
    }
  }

  // Degradation path: create fresh unencrypted instance and clear it
  cacheWasPurged = true;
  mmkvInstance = createMMKV({ id: `${MMKV_INSTANCE_ID}-fresh` });
  mmkvInstance.clearAll();

  return mmkvInstance;
}

/**
 * Get the initialized MMKV instance.
 * Returns null if not yet initialized.
 */
export function getEncryptedStorage(): MMKV | null {
  return mmkvInstance;
}

/**
 * Encrypted storage adapter for React Query cache persistence.
 * Safely handles the case where MMKV is not yet initialized.
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
    storage.remove(key);
  },
};
