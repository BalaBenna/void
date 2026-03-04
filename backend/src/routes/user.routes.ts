import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { getUsageStats } from "../services/usage.service";
import { supabaseAdmin } from "../lib/supabase";
import { PLAN_LIMITS } from "../shared/types";
import { env } from "../config/env";
import type { AppEnv } from "../shared/hono-env";

const users = new Hono<AppEnv>();

// All routes require authentication
users.use("/*", authMiddleware);

// ============================================================
// GET /v1/user/me
// Get current user profile
// ============================================================

users.get("/me", async (c) => {
  const userId = c.get("userId");

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, email, name, avatar_url, plan, created_at")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    plan: user.plan,
    createdAt: user.created_at,
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
    upgradeUrl: `${env.FRONTEND_URL}/pricing`,
  });
});

export default users;
