import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkUsageLimits, recordUsage } from "../services/usage.service";
import {
  createCompletion,
  streamCompletion,
  isProviderConfigured,
} from "../services/ai.service";
import { ERROR_CODES } from "../shared/types";
import type { CompletionRequest } from "../shared/types";
import type { AppEnv } from "../shared/hono-env";

const completions = new Hono<AppEnv>();

// All routes require authentication
completions.use("/*", authMiddleware);

// ============================================================
// POST /v1/completions
// Non-streaming completion
// ============================================================

completions.post("/", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan");
  const body: CompletionRequest = await c.req.json();

  const { configured, provider } = isProviderConfigured(body.model);
  if (!configured) {
    return c.json(
      { error: `Provider "${provider}" is not configured on this server. Missing API key.`, code: ERROR_CODES.PROVIDER_NOT_CONFIGURED },
      503
    );
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
  const plan = c.get("plan");
  const body: CompletionRequest = await c.req.json();

  const { configured, provider } = isProviderConfigured(body.model);
  if (!configured) {
    return c.json(
      { error: `Provider "${provider}" is not configured on this server. Missing API key.`, code: ERROR_CODES.PROVIDER_NOT_CONFIGURED },
      503
    );
  }

  const { allowed, reason, code } = await checkUsageLimits(
    userId,
    plan,
    body.model
  );
  if (!allowed) {
    return c.json({ error: reason, code }, 429);
  }

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
        await recordUsage(userId, totalInput, totalOutput, body.model, 0);
      }
    } catch (error: any) {
      await stream.write(
        `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`
      );
    }
  });
});

export default completions;
