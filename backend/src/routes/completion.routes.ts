import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkUsageLimits, recordUsage, recordError } from "../services/usage.service";
import {
  createCompletion,
  streamCompletion,
} from "../services/ai.service";
import {
  type CompletionRequest,
  type PlanType,
  PLAN_LIMITS,
  ERROR_CODES,
} from "../shared/types";

type Env = {
  Variables: {
    userId: string;
    email: string;
    plan: string;
  };
};

const completions = new Hono<Env>();

// All routes require authentication
completions.use("/*", authMiddleware);

// ============================================================
// POST /v1/completions
// Non-streaming completion
// ============================================================

completions.post("/", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;
  const body: CompletionRequest = await c.req.json();

  // Gate tool calling by plan
  if (body.tools && body.tools.length > 0) {
    const limits = PLAN_LIMITS[plan];
    if (!limits.agenticEnabled) {
      return c.json(
        {
          error: "Tool calling requires a Pro plan or higher",
          code: ERROR_CODES.MODEL_NOT_ALLOWED,
        },
        403
      );
    }
  }

  const { allowed, reason, code } = await checkUsageLimits(
    userId,
    plan,
    body.model
  );
  if (!allowed) {
    return c.json({ error: reason, code }, 429);
  }

  const startTime = Date.now();
  try {
    const response = await createCompletion(body);

    await recordUsage(
      userId,
      response.tokensUsed.input,
      response.tokensUsed.output,
      body.model,
      Date.now() - startTime
    );

    return c.json(response);
  } catch (error: any) {
    console.error("Completion error:", error);

    await recordError(
      userId,
      body.model,
      error.message || "AI completion failed",
      Date.now() - startTime
    );

    return c.json(
      { error: "AI completion failed", details: error.message },
      500
    );
  }
});

// ============================================================
// POST /v1/completions/stream
// Server-Sent Events streaming completion
// ============================================================

completions.post("/stream", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;
  const body: CompletionRequest = await c.req.json();

  // Gate tool calling by plan
  if (body.tools && body.tools.length > 0) {
    const limits = PLAN_LIMITS[plan];
    if (!limits.agenticEnabled) {
      return c.json(
        {
          error: "Tool calling requires a Pro plan or higher",
          code: ERROR_CODES.MODEL_NOT_ALLOWED,
        },
        403
      );
    }
  }

  const { allowed, reason, code } = await checkUsageLimits(
    userId,
    plan,
    body.model
  );
  if (!allowed) {
    return c.json({ error: reason, code }, 429);
  }

  const startTime = Date.now();

  return streamSSE(c, async (stream) => {
    try {
      let totalInput = 0;
      let totalOutput = 0;

      for await (const chunk of streamCompletion(body)) {
        await stream.write(chunk);

        try {
          const data = chunk.replace("data: ", "").trim();
          const parsed = JSON.parse(data);
          if (parsed.type === "done" && parsed.usage) {
            totalInput = parsed.usage.input;
            totalOutput = parsed.usage.output;
          }
        } catch {}
      }

      if (totalInput > 0 || totalOutput > 0) {
        await recordUsage(userId, totalInput, totalOutput, body.model, Date.now() - startTime);
      }
    } catch (error: any) {
      console.error("Stream completion error:", error);

      await recordError(
        userId,
        body.model,
        error.message || "Stream completion failed",
        Date.now() - startTime
      );

      await stream.write(
        `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`
      );
    }
  });
});

export default completions;
