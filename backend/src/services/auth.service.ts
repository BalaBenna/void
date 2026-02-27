import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../config/env";
import { redis } from "../config/redis";
import type { AuthTokenPayload, AuthResponse, User } from "../shared/types";
import crypto from "crypto";

// ============================================================
// Google OAuth Client
// ============================================================

const googleClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

/**
 * Generate the Google OAuth consent URL.
 * The desktop app opens this in the system browser.
 */
export function getGoogleAuthUrl(state?: string): string {
  return googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state: state || crypto.randomUUID(),
    prompt: "consent",
  });
}

/**
 * Exchange the Google auth code for user info, then find or create user.
 */
export async function handleGoogleCallback(
  code: string
): Promise<AuthResponse> {
  // 1. Exchange code for tokens
  const { tokens } = await googleClient.getToken(code);
  googleClient.setCredentials(tokens);

  // 2. Get user info from Google
  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token!,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Failed to get user info from Google");
  }

  // 3. Find or create user in DB
  const user = await findOrCreateUser({
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    avatarUrl: payload.picture,
    googleId: payload.sub,
  });

  // 4. Generate JWT tokens
  const authResponse = await generateTokens(user);

  return authResponse;
}

/**
 * Find existing user by Google ID or email, or create a new one.
 */
async function findOrCreateUser(profile: {
  email: string;
  name: string;
  avatarUrl?: string;
  googleId: string;
}): Promise<User> {
  // Try finding by Google ID first
  let [existingUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.googleId, profile.googleId))
    .limit(1);

  if (!existingUser) {
    // Try by email
    [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, profile.email))
      .limit(1);
  }

  if (existingUser) {
    // Update Google ID and avatar if needed
    const [updated] = await db
      .update(schema.users)
      .set({
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl || existingUser.avatarUrl,
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
      googleId: profile.googleId,
      plan: "free",
    })
    .returning();

  return mapUserToDto(newUser);
}

/**
 * Generate access + refresh JWT tokens.
 */
export async function generateTokens(user: User): Promise<AuthResponse> {
  const tokenPayload: Omit<AuthTokenPayload, "iat" | "exp"> = {
    userId: user.id,
    email: user.email,
    plan: user.plan,
  };

  const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRY,
  });

  const refreshToken = jwt.sign(tokenPayload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY,
  });

  // Store refresh token in DB
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.insert(schema.refreshTokens).values({
    userId: user.id,
    token: refreshToken,
    expiresAt,
  });

  return { token, refreshToken, user };
}

/**
 * Verify and decode a JWT access token.
 */
export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<AuthResponse> {
  // Verify the refresh token
  const payload = jwt.verify(
    refreshToken,
    env.JWT_REFRESH_SECRET
  ) as AuthTokenPayload;

  // Check if refresh token exists and is not revoked
  const [storedToken] = await db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.token, refreshToken))
    .limit(1);

  if (!storedToken || storedToken.revoked) {
    throw new Error("Invalid refresh token");
  }

  // Revoke the old refresh token (rotation)
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.id, storedToken.id));

  // Get user
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payload.userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  // Generate new tokens
  return generateTokens(mapUserToDto(user));
}

/**
 * Revoke all refresh tokens for a user (logout everywhere).
 */
export async function revokeAllTokens(userId: string): Promise<void> {
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.userId, userId));

  // Also invalidate cached session in Redis
  await redis.del(`session:${userId}`);
}

/**
 * Map DB user row to User DTO.
 */
function mapUserToDto(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl || undefined,
    plan: row.plan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
