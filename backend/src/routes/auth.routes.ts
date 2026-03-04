import { Hono } from "hono";
import {
  getSupabaseOAuthUrl,
  handleOAuthCallback,
  refreshSession,
} from "../services/auth.service";
import { env } from "../config/env";
import { redis } from "../config/redis";
import { authMiddleware } from "../middleware/auth.middleware";
import type { AppEnv } from "../shared/hono-env";

const auth = new Hono<AppEnv>();

// ============================================================
// GET /auth/google
// Desktop app opens this URL in the system browser.
// Redirects to Supabase's Google OAuth consent screen.
// ============================================================

auth.get("/google", async (c) => {
  const source = c.req.query("source") || "desktop";
  const url = await getSupabaseOAuthUrl(source);
  return c.redirect(url);
});

// ============================================================
// GET /auth/google/callback
// Supabase redirects here after Google consent.
// Exchanges the authorization code for a Supabase session.
// ============================================================

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing authorization code or state" }, 400);
  }

  try {
    const { accessToken, refreshToken, expiresAt, user, source } =
      await handleOAuthCallback(code, state);

    if (source === "desktop") {
      // DESKTOP FLOW: Redirect to custom protocol deep link
      const deepLink =
        `${env.DESKTOP_PROTOCOL}://auth/callback` +
        `?token=${encodeURIComponent(accessToken)}` +
        `&refreshToken=${encodeURIComponent(refreshToken)}` +
        `&expiresAt=${expiresAt}` +
        `&user=${encodeURIComponent(JSON.stringify(user))}`;

      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>Authenticating...</title></head>
          <body>
            <h2>Authentication successful!</h2>
            <p>Redirecting to Void...</p>
            <p>If the app doesn't open automatically,
               <a href="${deepLink}">click here</a>.</p>
            <script>
              window.location.href = "${deepLink}";
              setTimeout(() => {
                document.body.innerHTML += '<p>You can close this window.</p>';
              }, 3000);
            </script>
          </body>
        </html>
      `);
    } else {
      // WEB FLOW: Redirect to frontend with tokens
      const webRedirect =
        `${env.FRONTEND_URL}/auth/callback` +
        `?token=${encodeURIComponent(accessToken)}` +
        `&refreshToken=${encodeURIComponent(refreshToken)}` +
        `&expiresAt=${expiresAt}`;
      return c.redirect(webRedirect);
    }
  } catch (error: any) {
    console.error("OAuth callback error:", error);
    return c.json(
      { error: "Authentication failed", details: error.message },
      500
    );
  }
});

// ============================================================
// POST /auth/refresh
// Exchange a Supabase refresh token for a new session
// ============================================================

auth.post("/refresh", async (c) => {
  const body = await c.req.json();
  const { refreshToken } = body;

  if (!refreshToken) {
    return c.json({ error: "Refresh token required" }, 400);
  }

  try {
    const session = await refreshSession(refreshToken);
    return c.json({
      token: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: session.user,
    });
  } catch (error: any) {
    return c.json(
      { error: "Invalid refresh token", details: error.message },
      401
    );
  }
});

// ============================================================
// POST /auth/logout
// Clear cached auth state (Supabase handles token invalidation)
// ============================================================

auth.post("/logout", authMiddleware, async (c) => {
  const userId = c.get("userId");
  // Clear any cached auth/session data in Redis
  await redis.del(`session:${userId}`);
  return c.json({ message: "Logged out successfully" });
});

export default auth;
