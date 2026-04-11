import { Hono } from "hono";
import { eq, desc, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.middleware";
import { getUsageStats, recordSession } from "../services/usage.service";
import { db, schema } from "../db";
import { type PlanType, PLAN_LIMITS } from "../shared/types";

type Env = {
  Variables: {
    userId: string;
    email: string;
    plan: string;
  };
};

const users = new Hono<Env>();

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
    authProvider: user.authProvider,
    totalMessagesAllTime: user.totalMessagesAllTime,
    totalTokensAllTime: user.totalTokensAllTime,
    lastActiveAt: user.lastActiveAt?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
});

// ============================================================
// GET /v1/user/usage
// Get current usage stats
// ============================================================

users.get("/usage", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan");

  const stats = await getUsageStats(userId, plan as PlanType);
  return c.json(stats);
});

// ============================================================
// GET /v1/user/usage/history
// Get usage history for the last N days
// ============================================================

users.get("/usage/history", async (c) => {
  const userId = c.get("userId");
  const days = parseInt(c.req.query("days") || "30");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];

  const history = await db
    .select()
    .from(schema.dailyUsage)
    .where(
      and(
        eq(schema.dailyUsage.userId, userId),
        gte(schema.dailyUsage.date, startDateStr)
      )
    )
    .orderBy(desc(schema.dailyUsage.date));

  return c.json({
    days,
    usage: history.map((row) => ({
      date: row.date,
      messagesCount: row.messagesCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.inputTokens + row.outputTokens,
    })),
  });
});

// ============================================================
// GET /v1/user/requests
// Get recent request logs
// ============================================================

users.get("/requests", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);

  const logs = await db
    .select()
    .from(schema.requestLogs)
    .where(eq(schema.requestLogs.userId, userId))
    .orderBy(desc(schema.requestLogs.createdAt))
    .limit(limit);

  return c.json({
    requests: logs.map((row) => ({
      id: row.id,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.inputTokens + row.outputTokens,
      durationMs: row.durationMs,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
    })),
  });
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

// ============================================================
// POST /v1/user/session
// Record a device/app session heartbeat
// ============================================================

users.post("/session", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  await recordSession(
    userId,
    body.deviceId,
    body.platform,
    body.appVersion,
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || undefined
  );

  return c.json({ ok: true });
});

export default users;
