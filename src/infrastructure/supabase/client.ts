/**
 * Supabase client initialization.
 * Configures the client with Keychain-backed secure storage for token persistence.
 *
 * Production security: Tokens are stored in the iOS Keychain via expo-secure-store,
 * not in unencrypted AsyncStorage. This protects against:
 * - Filesystem access on jailbroken devices
 * - Unencrypted backup extraction
 * - Memory scraping of plaintext tokens
 */

import { createClient } from '@supabase/supabase-js';
import { SecureStorageAdapter } from '@/infrastructure/storage/secure-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
