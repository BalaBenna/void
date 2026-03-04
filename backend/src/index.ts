import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import completionRoutes from "./routes/completion.routes";
import userRoutes from "./routes/user.routes";
import sandboxRoutes from "./routes/sandbox.routes";
import embeddingsRoutes from "./routes/embeddings.routes";
import docsRoutes from "./routes/docs.routes";
import webhookRoutes from "./routes/webhook.routes";
import signalingRoutes from "./routes/signaling.routes";

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
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  })
);

// Auth routes (Google OAuth flow)
app.route("/auth", authRoutes);

// API v1 routes (authenticated)
app.route("/v1/completions", completionRoutes);
app.route("/v1/user", userRoutes);
app.route("/v1/sandbox", sandboxRoutes);
app.route("/v1/embeddings", embeddingsRoutes);
app.route("/v1/docs", docsRoutes);
app.route("/v1/webhooks", webhookRoutes);
app.route("/v1/signaling", signalingRoutes);

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
console.log(`  Port:  ${env.PORT}`);
console.log(`  Env:   ${env.NODE_ENV}`);
console.log(`  Auth:  /auth/google`);
console.log(`  API:   /v1/*`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
