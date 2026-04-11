import { Hono } from "hono";
import { randomUUID } from "crypto";
import { authMiddleware } from "../middleware/auth.middleware";
import { type PlanType, PLAN_LIMITS } from "../shared/types";

type Env = {
  Variables: {
    userId: string;
    email: string;
    plan: string;
  };
};

const sentinelRoutes = new Hono<Env>();

// All routes require authentication
sentinelRoutes.use("/*", authMiddleware);

// In-memory storage for now (swap with DB table for production)
const reviewStorage: Map<
  string,
  {
    id: string;
    userId: string;
    projectId?: string;
    branch: string;
    mode: string;
    issueCount: number;
    criticalCount: number;
    securityScore: number;
    qualityScore: number;
    duration: number;
    metadata: any;
    createdAt: string;
  }
> = new Map();

// ============================================================
// POST /v1/sentinel/reviews - Store review result
// ============================================================

sentinelRoutes.post("/reviews", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;

  // Free plan: no backend sync
  if (plan === "free") {
    return c.json(
      { error: "Backend sync requires Pro plan or above", code: "PLAN_LIMIT" },
      403
    );
  }

  const body = await c.req.json();
  const review = {
    id: randomUUID(),
    userId,
    projectId: body.projectId,
    branch: body.branch || "unknown",
    mode: body.mode || "quick",
    issueCount: body.issueCount || 0,
    criticalCount: body.criticalCount || 0,
    securityScore: body.securityScore ?? 100,
    qualityScore: body.qualityScore ?? 100,
    duration: body.duration || 0,
    metadata: body.metadata || {},
    createdAt: new Date().toISOString(),
  };

  reviewStorage.set(review.id, review);

  return c.json({ success: true, review });
});

// ============================================================
// GET /v1/sentinel/reviews - Get review history
// ============================================================

sentinelRoutes.get("/reviews", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;

  if (plan === "free") {
    return c.json(
      { error: "Review history requires Pro plan or above", code: "PLAN_LIMIT" },
      403
    );
  }

  const userReviews = Array.from(reviewStorage.values())
    .filter((r) => r.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

  return c.json({ reviews: userReviews });
});

// ============================================================
// GET /v1/sentinel/reviews/:id - Get specific review
// ============================================================

sentinelRoutes.get("/reviews/:id", async (c) => {
  const userId = c.get("userId");
  const reviewId = c.req.param("id");

  const review = reviewStorage.get(reviewId);
  if (!review || review.userId !== userId) {
    return c.json({ error: "Review not found", code: "NOT_FOUND" }, 404);
  }

  return c.json({ review });
});

// ============================================================
// GET /v1/sentinel/analytics - Aggregate analytics
// ============================================================

sentinelRoutes.get("/analytics", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;

  // Analytics require Team plan or above
  if (plan === "free" || plan === "pro") {
    return c.json(
      { error: "Analytics requires Team plan or above", code: "PLAN_LIMIT" },
      403
    );
  }

  const userReviews = Array.from(reviewStorage.values()).filter(
    (r) => r.userId === userId
  );

  const totalReviews = userReviews.length;
  const totalIssues = userReviews.reduce((sum, r) => sum + r.issueCount, 0);
  const totalCritical = userReviews.reduce((sum, r) => sum + r.criticalCount, 0);
  const avgSecurityScore =
    totalReviews > 0
      ? Math.round(
          userReviews.reduce((sum, r) => sum + r.securityScore, 0) / totalReviews
        )
      : 100;
  const avgQualityScore =
    totalReviews > 0
      ? Math.round(
          userReviews.reduce((sum, r) => sum + r.qualityScore, 0) / totalReviews
        )
      : 100;
  const avgDuration =
    totalReviews > 0
      ? Math.round(
          userReviews.reduce((sum, r) => sum + r.duration, 0) / totalReviews
        )
      : 0;

  // Issues by mode
  const reviewsByMode: Record<string, number> = {};
  for (const r of userReviews) {
    reviewsByMode[r.mode] = (reviewsByMode[r.mode] || 0) + 1;
  }

  return c.json({
    analytics: {
      totalReviews,
      totalIssues,
      totalCritical,
      avgSecurityScore,
      avgQualityScore,
      avgDuration,
      reviewsByMode,
      lastReviewAt: userReviews[0]?.createdAt || null,
    },
  });
});

export default sentinelRoutes;
