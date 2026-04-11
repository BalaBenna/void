import type { Context, Next } from "hono";
import { verifyToken } from "../services/auth.service";
import { ERROR_CODES } from "../shared/types";

/**
 * Supabase JWT authentication middleware.
 * Verifies the access token via Supabase Auth,
 * then sets `userId`, `email`, and `plan` on the context.
 */
export async function authMiddleware(c: Context, next: Next) {
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
    const payload = await verifyToken(token);

    c.set("userId", payload.userId);
    c.set("email", payload.email);
    c.set("plan", payload.plan);

    await next();
  } catch (error: any) {
    return c.json(
      {
        error: error.message || "Invalid token",
        code: ERROR_CODES.UNAUTHORIZED,
      },
      401
    );
  }
}
