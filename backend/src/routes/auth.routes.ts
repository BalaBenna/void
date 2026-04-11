import { Hono } from "hono";
import {
  getGoogleAuthUrl,
  exchangeCodeForSession,
  refreshAccessToken,
  revokeAllTokens,
  signUpWithEmail,
  signInWithEmail,
} from "../services/auth.service";
import { env } from "../config/env";
import { authMiddleware } from "../middleware/auth.middleware";
import { z } from "zod";

type Env = {
  Variables: {
    userId: string;
    email: string;
    plan: string;
  };
};

const auth = new Hono<Env>();

// ============================================================
// GET /auth/google
// Desktop app opens this URL in the system browser.
// Supabase handles the Google OAuth handshake.
// ============================================================

auth.get("/google", async (c) => {
  const source = c.req.query("source") || "desktop";

  // After Supabase completes OAuth, it redirects back to our callback
  const redirectTo = `${env.GOOGLE_REDIRECT_URI}?source=${source}`;
  const url = await getGoogleAuthUrl(redirectTo);

  return c.redirect(url);
});

// ============================================================
// GET /auth/google/callback
// Supabase redirects here with ?code=... after consent.
// We exchange the code for a session and redirect to the desktop app.
// ============================================================

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const source = c.req.query("source") || "desktop";

  if (!code) {
    return c.json({ error: "No authorization code received" }, 400);
  }

  try {
    const authResponse = await exchangeCodeForSession(code);

    if (source === "desktop") {
      // DESKTOP FLOW: Redirect to custom protocol
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
    console.error("Supabase OAuth error:", error);
    return c.json(
      { error: "Authentication failed", details: error.message },
      500
    );
  }
});

// ============================================================
// POST /auth/email/signup
// Create a new account with email and password
// ============================================================

const emailSignupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
});

auth.post("/email/signup", async (c) => {
  const body = await c.req.json();
  const parsed = emailSignupSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  try {
    const authResponse = await signUpWithEmail(
      parsed.data.email,
      parsed.data.password,
      parsed.data.name
    );
    return c.json(authResponse);
  } catch (error: any) {
    return c.json(
      { error: error.message || "Signup failed" },
      400
    );
  }
});

// ============================================================
// POST /auth/email/login
// Sign in with email and password
// ============================================================

const emailLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

auth.post("/email/login", async (c) => {
  const body = await c.req.json();
  const parsed = emailLoginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  try {
    const authResponse = await signInWithEmail(
      parsed.data.email,
      parsed.data.password
    );
    return c.json(authResponse);
  } catch (error: any) {
    return c.json(
      { error: error.message || "Login failed" },
      401
    );
  }
});

// ============================================================
// POST /auth/refresh
// Exchange a refresh token for a new access token via Supabase
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
