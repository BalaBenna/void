import crypto from "crypto";
import { supabaseAdmin } from "../lib/supabase";
import { env } from "../config/env";
import { redis } from "../config/redis";
import type { User } from "../shared/types";

// ============================================================
// PKCE Helpers (for server-side OAuth flow)
// ============================================================

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ============================================================
// OAuth URL Generation
// ============================================================

/**
 * Generate the Supabase Google OAuth URL for the desktop flow.
 * Stores the PKCE code_verifier in Redis keyed by state.
 */
export async function getSupabaseOAuthUrl(
  source: string = "desktop"
): Promise<string> {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Store PKCE verifier in Redis (5-minute TTL)
  const statePayload = JSON.stringify({ source, codeVerifier });
  await redis.setex(`pkce:${state}`, 300, statePayload);

  const callbackUrl = `${env.BACKEND_URL}/auth/google/callback`;

  // Construct the Supabase OAuth URL directly
  const params = new URLSearchParams({
    provider: "google",
    redirect_to: callbackUrl,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `${env.SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
}

// ============================================================
// OAuth Callback — Exchange code for session
// ============================================================

export async function handleOAuthCallback(
  code: string,
  state: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
  source: string;
}> {
  // Retrieve PKCE verifier from Redis
  const statePayload = await redis.get(`pkce:${state}`);
  if (!statePayload) {
    throw new Error("Invalid or expired state parameter");
  }

  const { source, codeVerifier } = JSON.parse(statePayload);

  // Delete the PKCE entry (single-use)
  await redis.del(`pkce:${state}`);

  // Exchange the authorization code for a Supabase session
  // Use Supabase Auth REST API directly for server-side PKCE exchange
  const tokenResponse = await fetch(
    `${env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        auth_code: code,
        code_verifier: codeVerifier,
      }),
    }
  );

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${errBody}`);
  }

  const session = await tokenResponse.json();

  // session contains: access_token, refresh_token, expires_in, expires_at, user
  const supabaseUser = session.user;

  // Ensure user profile row exists in public.users
  await ensureUserProfile(supabaseUser);

  // Fetch the full profile (includes plan, stripe info, etc.)
  const user = await getUserProfile(supabaseUser.id);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at, // unix timestamp
    user,
    source,
  };
}

// ============================================================
// Token Refresh
// ============================================================

export async function refreshSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
}> {
  // Use Supabase Auth REST API for server-side refresh
  const response = await fetch(
    `${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Session refresh failed: ${errBody}`);
  }

  const session = await response.json();

  const user = await getUserProfile(session.user.id);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    user,
  };
}

// ============================================================
// Token Verification
// ============================================================

/**
 * Verify a Supabase access token and return the user's identity + plan.
 */
export async function verifyAccessToken(accessToken: string): Promise<{
  userId: string;
  email: string;
  plan: string;
}> {
  // Check Redis cache first (60s TTL)
  const tokenHash = crypto
    .createHash("sha256")
    .update(accessToken)
    .digest("hex");
  const cached = await redis.get(`auth:${tokenHash}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Verify with Supabase
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error(error?.message ?? "Invalid token");
  }

  // Fetch plan from public.users
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single();

  const result = {
    userId: user.id,
    email: user.email!,
    plan: (profile?.plan as string) ?? "free",
  };

  // Cache for 60 seconds
  await redis.setex(`auth:${tokenHash}`, 60, JSON.stringify(result));

  return result;
}

// ============================================================
// User Profile Helpers
// ============================================================

async function getUserProfile(userId: string): Promise<User> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(`User profile not found: ${error?.message}`);
  }

  return mapToUserDto(data);
}

/**
 * Defensive upsert — ensures public.users row exists.
 * The DB trigger on auth.users should handle this, but this is a fallback.
 */
async function ensureUserProfile(supabaseUser: any): Promise<void> {
  const name =
    supabaseUser.user_metadata?.full_name ||
    supabaseUser.email?.split("@")[0] ||
    "User";

  await supabaseAdmin.from("users").upsert(
    {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name,
      avatar_url: supabaseUser.user_metadata?.avatar_url ?? null,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
}

function mapToUserDto(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
    plan: row.plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
