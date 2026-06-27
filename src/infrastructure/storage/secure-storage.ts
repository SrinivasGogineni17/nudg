/**
 * Keychain-backed secure storage adapter for Supabase auth tokens.
 *
 * Uses expo-secure-store which stores data in the iOS Keychain (encrypted at rest,
 * protected by the device passcode/biometrics). This replaces the default
 * AsyncStorage adapter that stores tokens in unencrypted plist files.
 *
 * Security: iOS Keychain items are:
 * - Encrypted with hardware-backed keys (Secure Enclave on supported devices)
 * - Not included in unencrypted iTunes backups
 * - Wiped on device reset
 * - Protected by kSecAttrAccessibleAfterFirstUnlock (available after first device unlock)
 */

import * as SecureStore from 'expo-secure-store';

/** Key prefix to namespace our Supabase tokens. */
const KEY_PREFIX = 'nudg_sb_';

/**
 * A storage adapter compatible with Supabase's auth.storage option.
 * Drop-in replacement for AsyncStorage that uses the iOS Keychain.
 */
export const SecureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(`${KEY_PREFIX}${key}`);
    } catch {
      // SecureStore throws if the item doesn't exist on some platforms
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(`${KEY_PREFIX}${key}`, value, {
      // Available after first unlock — allows background token refresh
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  },

  async removeItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(`${KEY_PREFIX}${key}`);
    } catch {
      // Ignore errors when item doesn't exist
    }
  },
};
