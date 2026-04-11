import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

/**
 * Supabase Admin client (uses the service_role key).
 * This has full access to auth and data — only use server-side.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Create a per-request Supabase client scoped to a user's access token.
 * Used in middleware to verify and act on behalf of the user.
 */
export function createSupabaseClient(accessToken?: string) {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {},
    },
  });
}
