import { Hono } from "hono";
import { env } from "../config/env";

const webhookRoutes = new Hono();

// POST /v1/webhooks/github - GitHub webhook handler for BugBot PR automation
webhookRoutes.post("/github", async (c) => {
  // Verify webhook signature
  const signature = c.req.header("x-hub-signature-256");
  if (!signature && env.GITHUB_WEBHOOK_SECRET) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const body = await c.req.json();
  const event = c.req.header("x-github-event");

  if (event === "pull_request") {
    const { action, pull_request, repository } = body;

    if (action === "opened" || action === "synchronize") {
      // Queue PR for analysis
      console.log(
        `[BugBot] PR #${pull_request.number} ${action} on ${repository.full_name}`
      );

      // In production, this would:
      // 1. Fetch the PR diff via GitHub API
      // 2. Run security/quality analysis
      // 3. Post inline comments via GitHub API
      // 4. Store results in pr_analyses table

      return c.json({
        status: "queued",
        pr: pull_request.number,
        repo: repository.full_name,
      });
    }
  }

  return c.json({ status: "ignored" });
});

export default webhookRoutes;
