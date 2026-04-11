import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { supabaseAdmin } from "../config/supabase";
import type { AuthResponse, User } from "../shared/types";

// ============================================================
// Supabase OAuth URL
// ============================================================

/**
 * Generate the Google OAuth URL via Supabase Auth.
 * Supabase handles the entire OAuth handshake.
 */
export async function getGoogleAuthUrl(redirectTo: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw new Error(`Supabase OAuth error: ${error.message}`);
  return data.url;
}

// ============================================================
// Exchange Code for Session
// ============================================================

/**
 * Exchange a Supabase auth code for a session.
 * Called after Supabase redirects back with ?code=...
 */
export async function exchangeCodeForSession(
  code: string
): Promise<AuthResponse> {
  const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    throw new Error(error?.message || "Failed to exchange code for session");
  }

  const supabaseUser = data.user;

  // Sync user to our DB (find or create)
  const user = await findOrCreateUser({
    email: supabaseUser.email!,
    name:
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.user_metadata?.name ||
      supabaseUser.email!.split("@")[0],
    avatarUrl: supabaseUser.user_metadata?.avatar_url || null,
    supabaseId: supabaseUser.id,
  });

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user,
  };
}

// ============================================================
// Refresh Token
// ============================================================

/**
 * Refresh a Supabase session using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<AuthResponse> {
  const { data, error } = await supabaseAdmin.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session || !data.user) {
    throw new Error(error?.message || "Failed to refresh session");
  }

  // Get user from our DB
  const [dbUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, data.user.email!))
    .limit(1);

  if (!dbUser) {
    throw new Error("User not found");
  }

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserToDto(dbUser),
  };
}

// ============================================================
// Verify Token
// ============================================================

/**
 * Verify a Supabase access token and return user info.
 */
export async function verifyToken(
  token: string
): Promise<{ userId: string; email: string; plan: string }> {
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw new Error(error?.message || "Invalid token");
  }

  // Look up our DB user
  const [dbUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, user.email!))
    .limit(1);

  if (!dbUser) {
    throw new Error("User not found in database");
  }

  return {
    userId: dbUser.id,
    email: dbUser.email,
    plan: dbUser.plan,
  };
}

// ============================================================
// Email Auth
// ============================================================

/**
 * Sign up a new user with email and password via Supabase Auth.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string
): Promise<AuthResponse> {
  // Use admin API to create user with auto-confirm (skips email verification)
  const { data: adminData, error: adminError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });

  if (adminError || !adminData.user) {
    throw new Error(adminError?.message || "Failed to create account");
  }

  // Now sign in to get a session token
  const { data: signInData, error: signInError } =
    await supabaseAdmin.auth.signInWithPassword({ email, password });

  if (signInError || !signInData.session) {
    throw new Error(signInError?.message || "Account created but sign-in failed");
  }

  const user = await findOrCreateUser({
    email: adminData.user.email!,
    name,
    avatarUrl: null,
    supabaseId: adminData.user.id,
    authProvider: "email",
  });

  return {
    token: signInData.session.access_token,
    refreshToken: signInData.session.refresh_token,
    user,
  };
}

/**
 * Sign in an existing user with email and password via Supabase Auth.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResponse> {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    throw new Error(error?.message || "Invalid email or password");
  }

  // Look up user in our DB
  const [dbUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, data.user.email!))
    .limit(1);

  if (!dbUser) {
    // User exists in Supabase but not in our DB — create them
    const user = await findOrCreateUser({
      email: data.user.email!,
      name:
        data.user.user_metadata?.full_name ||
        data.user.email!.split("@")[0],
      avatarUrl: null,
      supabaseId: data.user.id,
    });

    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user,
    };
  }

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserToDto(dbUser),
  };
}

/**
 * Revoke all sessions — used for "logout everywhere".
 */
export async function revokeAllTokens(userId: string): Promise<void> {
  // Supabase handles session revocation, but we also clean up
  // any refresh tokens we stored in our DB
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.userId, userId));
}

// ============================================================
// Find or Create User
// ============================================================

async function findOrCreateUser(profile: {
  email: string;
  name: string;
  avatarUrl: string | null;
  supabaseId: string;
  authProvider?: string;
}): Promise<User> {
  // Try by email first
  let [existingUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, profile.email))
    .limit(1);

  if (existingUser) {
    // Update avatar and last active
    const [updated] = await db
      .update(schema.users)
      .set({
        avatarUrl: profile.avatarUrl || existingUser.avatarUrl,
        googleId: profile.supabaseId || existingUser?.googleId,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingUser.id))
      .returning();

    return mapUserToDto(updated);
  }

  // Create new user
  const [newUser] = await db
    .insert(schema.users)
    .values({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      googleId: profile.supabaseId,
      authProvider: profile.authProvider || "google",
      plan: "free",
      lastActiveAt: new Date(),
    })
    .returning();

  return mapUserToDto(newUser);
}

// ============================================================
// DTO Mapper
// ============================================================

function mapUserToDto(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    plan: row.plan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
