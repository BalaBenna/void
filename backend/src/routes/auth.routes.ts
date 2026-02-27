import { Hono } from "hono";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  refreshAccessToken,
  revokeAllTokens,
} from "../services/auth.service";
import { env } from "../config/env";
import { authMiddleware } from "../middleware/auth.middleware";

const auth = new Hono();

// ============================================================
// GET /auth/google
// Desktop app opens this URL in the system browser
// ============================================================

auth.get("/google", (c) => {
  const source = c.req.query("source") || "desktop";
  const state = JSON.stringify({ source });
  const url = getGoogleAuthUrl(state);
  return c.redirect(url);
});

// ============================================================
// GET /auth/google/callback
// Google redirects here after consent
// ============================================================

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const stateStr = c.req.query("state");

  if (!code) {
    return c.json({ error: "No authorization code received" }, 400);
  }

  try {
    const authResponse = await handleGoogleCallback(code);

    // Parse state to determine redirect target
    let source = "desktop";
    try {
      const state = JSON.parse(stateStr || "{}");
      source = state.source || "desktop";
    } catch {}

    if (source === "desktop") {
      // DESKTOP FLOW: Redirect to custom protocol
      // The Electron app registers void:// as a protocol handler
      const deepLink =
        `${env.DESKTOP_PROTOCOL}://auth/callback` +
        `?token=${encodeURIComponent(authResponse.token)}` +
        `&refreshToken=${encodeURIComponent(authResponse.refreshToken)}` +
        `&user=${encodeURIComponent(JSON.stringify(authResponse.user))}`;

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
        `?token=${encodeURIComponent(authResponse.token)}` +
        `&refreshToken=${encodeURIComponent(authResponse.refreshToken)}`;
      return c.redirect(webRedirect);
    }
  } catch (error: any) {
    console.error("Google OAuth error:", error);
    return c.json({ error: "Authentication failed", details: error.message }, 500);
  }
});

// ============================================================
// POST /auth/refresh
// Exchange a refresh token for a new access token
// ============================================================

auth.post("/refresh", async (c) => {
  const body = await c.req.json();
  const { refreshToken } = body;

  if (!refreshToken) {
    return c.json({ error: "Refresh token required" }, 400);
  }

  try {
    const authResponse = await refreshAccessToken(refreshToken);
    return c.json(authResponse);
  } catch (error: any) {
    return c.json(
      { error: "Invalid refresh token", details: error.message },
      401
    );
  }
});

// ============================================================
// POST /auth/logout
// Revoke all tokens for the authenticated user
// ============================================================

auth.post("/logout", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await revokeAllTokens(userId);
  return c.json({ message: "Logged out successfully" });
});

export default auth;
