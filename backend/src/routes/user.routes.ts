import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.middleware";
import { getUsageStats } from "../services/usage.service";
import { db, schema } from "../db";
import { PLAN_LIMITS } from "../shared/types";

const users = new Hono();

// All routes require authentication
users.use("/*", authMiddleware);

// ============================================================
// GET /v1/user/me
// Get current user profile
// ============================================================

users.get("/me", async (c) => {
  const userId = c.get("userId");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    plan: user.plan,
    createdAt: user.createdAt,
  });
});

// ============================================================
// GET /v1/user/usage
// Get current usage stats
// ============================================================

users.get("/usage", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan");

  const stats = await getUsageStats(userId, plan);
  return c.json(stats);
});

// ============================================================
// GET /v1/user/plan
// Get plan details and limits
// ============================================================

users.get("/plan", async (c) => {
  const plan = c.get("plan");

  return c.json({
    currentPlan: plan,
    limits: PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS],
    upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
  });
});

export default users;
