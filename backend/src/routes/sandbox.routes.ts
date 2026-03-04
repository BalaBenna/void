import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { env } from "../config/env";
import { PLAN_LIMITS } from "../shared/types";
import type { AppEnv } from "../shared/hono-env";

const app = new Hono<AppEnv>();

// All sandbox routes require authentication
app.use("*", authMiddleware);

// Plan-gating: sandbox requires agenticEnabled (Pro+)
app.use("*", async (c, next) => {
  const plan = c.get("plan");
  if (!PLAN_LIMITS[plan].agenticEnabled) {
    return c.json(
      { error: "Sandbox requires Pro plan or above", code: "PLAN_LIMIT_EXCEEDED" },
      403
    );
  }
  await next();
});

// ============================================================
// E2B Sandbox Session Management
// ============================================================

// In-memory sandbox sessions (keyed by userId)
// In production, this could be backed by Redis for multi-instance deployments
const activeSandboxes: Map<
  string,
  {
    sandbox: any; // E2B Sandbox instance
    template: string | undefined;
    createdAt: number;
    lastActivity: number;
  }
> = new Map();

// Cleanup idle sandboxes periodically (every 5 minutes)
const cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [userId, session] of activeSandboxes.entries()) {
      // Kill sandboxes idle for more than 10 minutes
      if (now - session.lastActivity > 10 * 60 * 1000) {
        try {
          session.sandbox?.kill?.();
        } catch {
          // ignore cleanup errors
        }
        activeSandboxes.delete(userId);
      }
    }
  },
  5 * 60 * 1000
);
// Don't prevent process from exiting cleanly
cleanupInterval.unref();

/**
 * POST /sandbox/execute
 * Execute a command in the user's E2B sandbox.
 * Creates a sandbox on first use, reuses for subsequent calls.
 */
app.post("/execute", async (c) => {
  const apiKey = env.E2B_API_KEY;
  if (!apiKey) {
    return c.json(
      { error: "E2B is not configured on this server", code: "E2B_NOT_CONFIGURED" },
      503
    );
  }

  const userId = c.get("userId") as string;
  const body = await c.req.json<{
    command: string;
    cwd?: string;
    timeoutMs?: number;
    template?: string;
  }>();

  if (!body.command) {
    return c.json({ error: "command is required", code: "INVALID_REQUEST" }, 400);
  }

  try {
    // Lazy-import the E2B SDK (it's a Node.js module)
    const { Sandbox } = await import("@e2b/code-interpreter");

    // Get or create sandbox for this user
    let session = activeSandboxes.get(userId);
    if (session && session.template !== body.template) {
      // Template changed — kill old sandbox and create a new one
      try { await session.sandbox.kill(); } catch { }
      activeSandboxes.delete(userId);
      session = undefined;
    }
    if (!session) {
      const sandbox = await Sandbox.create({
        apiKey,
        ...(body.template ? { template: body.template } : {}),
      });
      session = {
        sandbox,
        template: body.template,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      activeSandboxes.set(userId, session);
    }

    session.lastActivity = Date.now();
    const timeout = Math.min(body.timeoutMs ?? 300_000, 600_000); // Max 10 min

    // Execute the command
    const result = await session.sandbox.commands.run(body.command, {
      cwd: body.cwd,
      timeoutMs: timeout,
    });

    return c.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error: any) {
    // If sandbox died, remove it so next call creates a fresh one
    activeSandboxes.delete(userId);
    return c.json(
      {
        error: "Sandbox execution failed",
        code: "E2B_EXECUTION_ERROR",
        details: error?.message ?? String(error),
      },
      500
    );
  }
});

/**
 * POST /sandbox/write-file
 * Write a file into the user's E2B sandbox.
 */
app.post("/write-file", async (c) => {
  const apiKey = env.E2B_API_KEY;
  if (!apiKey) {
    return c.json({ error: "E2B is not configured", code: "E2B_NOT_CONFIGURED" }, 503);
  }

  const userId = c.get("userId") as string;
  const body = await c.req.json<{ path: string; content: string }>();

  if (!body.path || body.content === undefined) {
    return c.json({ error: "path and content are required", code: "INVALID_REQUEST" }, 400);
  }

  const session = activeSandboxes.get(userId);
  if (!session) {
    return c.json({ error: "No active sandbox. Run a command first.", code: "NO_SANDBOX" }, 404);
  }

  try {
    session.lastActivity = Date.now();
    await session.sandbox.files.write(body.path, body.content);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json(
      { error: "File write failed", code: "E2B_FILE_ERROR", details: error?.message },
      500
    );
  }
});

/**
 * POST /sandbox/read-file
 * Read a file from the user's E2B sandbox.
 */
app.post("/read-file", async (c) => {
  const apiKey = env.E2B_API_KEY;
  if (!apiKey) {
    return c.json({ error: "E2B is not configured", code: "E2B_NOT_CONFIGURED" }, 503);
  }

  const userId = c.get("userId") as string;
  const body = await c.req.json<{ path: string }>();

  if (!body.path) {
    return c.json({ error: "path is required", code: "INVALID_REQUEST" }, 400);
  }

  const session = activeSandboxes.get(userId);
  if (!session) {
    return c.json({ error: "No active sandbox. Run a command first.", code: "NO_SANDBOX" }, 404);
  }

  try {
    session.lastActivity = Date.now();
    const content = await session.sandbox.files.read(body.path, { format: "text" });
    return c.json({ content });
  } catch (error: any) {
    return c.json(
      { error: "File read failed", code: "E2B_FILE_ERROR", details: error?.message },
      500
    );
  }
});

/**
 * DELETE /sandbox
 * Kill the user's E2B sandbox.
 */
app.delete("/", async (c) => {
  const userId = c.get("userId") as string;
  const session = activeSandboxes.get(userId);

  if (session) {
    try {
      await session.sandbox.kill();
    } catch {
      // ignore
    }
    activeSandboxes.delete(userId);
  }

  return c.json({ success: true });
});

/**
 * GET /sandbox/status
 * Check if user has an active sandbox and if E2B is configured.
 */
app.get("/status", async (c) => {
  const userId = c.get("userId") as string;
  const session = activeSandboxes.get(userId);

  return c.json({
    e2bConfigured: !!env.E2B_API_KEY,
    hasActiveSandbox: !!session,
    sandboxAge: session ? Date.now() - session.createdAt : null,
  });
});

export default app;
