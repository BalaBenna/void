import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../config/redis";
import {
  PLAN_LIMITS,
  ERROR_CODES,
} from "../shared/types";
import type { PlanType, UsageStats } from "../shared/types";

/**
 * Get today's date string in YYYY-MM-DD format.
 */
function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get current usage stats for a user.
 */
export async function getUsageStats(
  userId: string,
  plan: PlanType
): Promise<UsageStats> {
  const today = getTodayString();
  const cacheKey = `usage:${userId}:${today}`;

  // Try Redis cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Query DB
  const [usage] = await db
    .select()
    .from(schema.dailyUsage)
    .where(
      and(
        eq(schema.dailyUsage.userId, userId),
        eq(schema.dailyUsage.date, today)
      )
    )
    .limit(1);

  const limits = PLAN_LIMITS[plan];
  const stats: UsageStats = {
    messagesUsedToday: usage?.messagesCount || 0,
    messagesLimit: limits.messagesPerDay,
    tokensUsedToday: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
    plan,
  };

  // Cache for 30 seconds
  await redis.setex(cacheKey, 30, JSON.stringify(stats));

  return stats;
}

/**
 * Check if user can make a request based on their plan limits.
 */
export async function checkUsageLimits(
  userId: string,
  plan: PlanType,
  model: string
): Promise<{ allowed: boolean; reason?: string; code?: string }> {
  const limits = PLAN_LIMITS[plan];

  // Check model access
  if (!limits.allowedModels.includes("*") && !limits.allowedModels.includes(model)) {
    return {
      allowed: false,
      reason: `Model ${model} is not available on the ${plan} plan. Upgrade to access this model.`,
      code: ERROR_CODES.MODEL_NOT_ALLOWED,
    };
  }

  // Check daily message limit (-1 = unlimited)
  if (limits.messagesPerDay !== -1) {
    const stats = await getUsageStats(userId, plan);
    if (stats.messagesUsedToday >= limits.messagesPerDay) {
      return {
        allowed: false,
        reason: `Daily message limit reached (${limits.messagesPerDay}). Upgrade your plan for more messages.`,
        code: ERROR_CODES.PLAN_LIMIT_EXCEEDED,
      };
    }
  }

  // Check rate limiting (per-minute burst protection)
  const rateLimitKey = `ratelimit:${userId}:${Math.floor(Date.now() / 60000)}`;
  const currentRate = await redis.incr(rateLimitKey);
  if (currentRate === 1) {
    await redis.expire(rateLimitKey, 60);
  }
  const maxPerMinute = plan === "free" ? 10 : plan === "pro" ? 30 : 60;
  if (currentRate > maxPerMinute) {
    return {
      allowed: false,
      reason: "Too many requests. Please slow down.",
      code: ERROR_CODES.RATE_LIMITED,
    };
  }

  return { allowed: true };
}

/**
 * Record usage after a successful completion.
 */
export async function recordUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
  durationMs: number
): Promise<void> {
  const today = getTodayString();
  const totalTokens = inputTokens + outputTokens;

  // Upsert daily usage
  const [existing] = await db
    .select()
    .from(schema.dailyUsage)
    .where(
      and(
        eq(schema.dailyUsage.userId, userId),
        eq(schema.dailyUsage.date, today)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.dailyUsage)
      .set({
        messagesCount: existing.messagesCount + 1,
        inputTokens: existing.inputTokens + inputTokens,
        outputTokens: existing.outputTokens + outputTokens,
        updatedAt: new Date(),
      })
      .where(eq(schema.dailyUsage.id, existing.id));
  } else {
    await db.insert(schema.dailyUsage).values({
      userId,
      date: today,
      messagesCount: 1,
      inputTokens,
      outputTokens,
    });
  }

  // Log the request
  await db.insert(schema.requestLogs).values({
    userId,
    model,
    inputTokens,
    outputTokens,
    durationMs,
    status: "success",
  });

  // Update user lifetime stats and last active timestamp
  await db
    .update(schema.users)
    .set({
      lastActiveAt: new Date(),
      totalMessagesAllTime: sql`${schema.users.totalMessagesAllTime} + 1`,
      totalTokensAllTime: sql`${schema.users.totalTokensAllTime} + ${totalTokens}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));

  // Invalidate cache
  await redis.del(`usage:${userId}:${today}`);
}

/**
 * Record a failed request for tracking and debugging.
 */
export async function recordError(
  userId: string,
  model: string,
  errorMessage: string,
  durationMs: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.insert(schema.requestLogs).values({
    userId,
    model,
    inputTokens: 0,
    outputTokens: 0,
    durationMs,
    status: "error",
    errorMessage,
    metadata: metadata || null,
  });

  // Update last active even on errors
  await db
    .update(schema.users)
    .set({ lastActiveAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/**
 * Record or update a user session (device/login tracking).
 */
export async function recordSession(
  userId: string,
  deviceId?: string,
  platform?: string,
  appVersion?: string,
  ipAddress?: string
): Promise<void> {
  if (!deviceId) {
    // No device ID, just create a new session entry
    await db.insert(schema.userSessions).values({
      userId,
      platform,
      appVersion,
      ipAddress,
    });
    return;
  }

  // Upsert by userId + deviceId
  const [existing] = await db
    .select()
    .from(schema.userSessions)
    .where(
      and(
        eq(schema.userSessions.userId, userId),
        eq(schema.userSessions.deviceId, deviceId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.userSessions)
      .set({
        lastSeenAt: new Date(),
        platform: platform || existing.platform,
        appVersion: appVersion || existing.appVersion,
        ipAddress: ipAddress || existing.ipAddress,
      })
      .where(eq(schema.userSessions.id, existing.id));
  } else {
    await db.insert(schema.userSessions).values({
      userId,
      deviceId,
      platform,
      appVersion,
      ipAddress,
    });
  }
}
