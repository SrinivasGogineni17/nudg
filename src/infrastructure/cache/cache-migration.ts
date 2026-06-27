/**
 * Local cache migration strategy.
 *
 * Pillar 5: Safe Local Data Migrations for Existing Users
 *
 * Since Nudg uses Supabase as the source of truth (not local DB), the main
 * concern is migrating the LOCAL CACHE FORMAT when app updates change the
 * shape of cached data.
 *
 * Strategy:
 * 1. Version the cache with a key (e.g., 'nudg_query_cache_v1')
 * 2. On app update, if the cache version doesn't match, clear stale cache
 * 3. The app re-fetches fresh data from Supabase — no data loss
 *
 * For the auth token migration (AsyncStorage → SecureStore):
 * 1. On first launch after update, check if old AsyncStorage token exists
 * 2. If found, migrate it to SecureStore
 * 3. Delete the old AsyncStorage entry
 * 4. Supabase client continues with the migrated token seamlessly
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const MIGRATION_VERSION_KEY = 'nudg_migration_version';
const CURRENT_MIGRATION_VERSION = 2;

/**
 * Run any pending local data migrations.
 * Call this once on app startup, before rendering the main UI.
 */
export async function runLocalMigrations(): Promise<void> {
  const currentVersion = await getStoredMigrationVersion();

  if (currentVersion < 1) {
    await migrateV0ToV1();
  }

  if (currentVersion < 2) {
    await migrateV1ToV2();
  }

  await AsyncStorage.setItem(
    MIGRATION_VERSION_KEY,
    String(CURRENT_MIGRATION_VERSION)
  );
}

async function getStoredMigrationVersion(): Promise<number> {
  const stored = await AsyncStorage.getItem(MIGRATION_VERSION_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

/**
 * Migration v0 → v1: Move auth tokens from AsyncStorage to SecureStore (Keychain).
 * This runs for users updating from the pre-production build.
 */
async function migrateV0ToV1(): Promise<void> {
  try {
    // Supabase stores session under this key in AsyncStorage
    const oldSessionKey = 'supabase.auth.token';
    const oldSession = await AsyncStorage.getItem(oldSessionKey);

    if (oldSession) {
      // Write to SecureStore with our prefixed key
      await SecureStore.setItemAsync(`nudg_sb_${oldSessionKey}`, oldSession, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });

      // Remove from AsyncStorage
      await AsyncStorage.removeItem(oldSessionKey);
    }
  } catch {
    // Migration failure is non-fatal — user will just need to log in again
  }
}

/**
 * Migration v1 → v2: Clear stale query cache after schema changes.
 * When Supabase migrations change the response shape, old cached data
 * could cause rendering errors. This clears it safely.
 */
async function migrateV1ToV2(): Promise<void> {
  try {
    await AsyncStorage.removeItem('nudg_query_cache_v1');
  } catch {
    // Non-fatal
  }
}
