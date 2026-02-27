import type { Context, Next } from "hono";
import { verifyToken } from "../services/auth.service";
import { ERROR_CODES } from "../shared/types";
import type { AuthTokenPayload } from "../shared/types";

/**
 * JWT authentication middleware.
 * Extracts and verifies the Bearer token from Authorization header.
 * Sets `userId`, `email`, and `plan` on the context.
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
    const payload: AuthTokenPayload = verifyToken(token);

    c.set("userId", payload.userId);
    c.set("email", payload.email);
    c.set("plan", payload.plan);

    await next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return c.json(
        {
          error: "Token expired. Please refresh your token.",
          code: ERROR_CODES.UNAUTHORIZED,
        },
        401
      );
    }

    return c.json(
      {
        error: "Invalid token",
        code: ERROR_CODES.UNAUTHORIZED,
      },
      401
    );
  }
}
