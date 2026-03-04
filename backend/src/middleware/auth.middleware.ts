import type { Context, Next } from "hono";
import { verifyAccessToken } from "../services/auth.service";
import { ERROR_CODES } from "../shared/types";
import type { PlanType } from "../shared/types";
import type { AppEnv } from "../shared/hono-env";

/**
 * Supabase JWT authentication middleware.
 * Verifies the Bearer token via Supabase Auth (with Redis cache).
 * Sets `userId`, `email`, and `plan` on the context.
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Authentication required",
        code: ERROR_CODES.UNAUTHORIZED,
      },
      401
    );
  }

  const token = authHeader.slice(7);

  try {
    const { userId, email, plan } = await verifyAccessToken(token);

    c.set("userId", userId);
    c.set("email", email);
    c.set("plan", plan as PlanType);

    await next();
  } catch {
    return c.json(
      {
        error: "Invalid or expired token",
        code: ERROR_CODES.UNAUTHORIZED,
      },
      401
    );
  }
}
