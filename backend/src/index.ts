import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import completionRoutes from "./routes/completion.routes";
import userRoutes from "./routes/user.routes";
import projectRoutes from "./routes/project.routes";
import stripeRoutes from "./routes/stripe.routes";
import sentinelRoutes from "./routes/sentinel.routes";

// ============================================================
// App Setup
// ============================================================

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: [
      env.FRONTEND_URL,
      "vscode-file://vscode-app",
      "http://localhost:*",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// ============================================================
// Routes
// ============================================================

// Health check
app.get("/health", async (c) => {
  let dbStatus = "ok";
  let redisStatus = "ok";

  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = "error";
  }

  try {
    const { redis } = await import("./config/redis");
    await redis.ping();
  } catch {
    redisStatus = "error";
  }

  const overall = dbStatus === "ok" && redisStatus === "ok" ? "ok" : "degraded";

  return c.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    },
    overall === "ok" ? 200 : 503
  );
});

// Auth routes (Google OAuth flow)
app.route("/auth", authRoutes);

// API v1 routes (authenticated)
app.route("/v1/completions", completionRoutes);
app.route("/v1/user", userRoutes);
app.route("/v1/projects", projectRoutes);
app.route("/v1/sentinel", sentinelRoutes);

// Stripe webhooks (signature-verified, no auth middleware)
app.route("/stripe", stripeRoutes);

// ============================================================
// Error Handler
// ============================================================

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      ...(env.NODE_ENV === "development" && { details: err.message }),
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// ============================================================
// Start Server
// ============================================================

console.log(`Void Backend Server`);
console.log(`  Port:     ${env.PORT}`);
console.log(`  Env:      ${env.NODE_ENV}`);
console.log(`  Auth:     /auth/google`);
console.log(`  API:      /v1/*`);
console.log(`  Providers: Anthropic${env.OPENAI_API_KEY ? ", OpenAI" : ""}${env.GOOGLE_AI_API_KEY ? ", Gemini" : ""}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
