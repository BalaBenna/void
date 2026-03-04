import { Hono } from "hono";

const docsRoutes = new Hono();

// POST /v1/docs/index - Index a library's documentation
docsRoutes.post("/index", async (c) => {
  const body = await c.req.json();
  const { packageName, version } = body;

  if (!packageName) {
    return c.json({ error: "packageName is required" }, 400);
  }

  // Placeholder — in production this would:
  // 1. Fetch docs from npm registry / GitHub
  // 2. Parse and chunk the documentation
  // 3. Store chunks with embeddings in doc_cache table
  return c.json({
    status: "indexed",
    packageName,
    version: version || "latest",
    chunks: 0,
  });
});

// POST /v1/docs/search - Search indexed documentation
docsRoutes.post("/search", async (c) => {
  const body = await c.req.json();
  const { query, packageName, maxResults } = body;

  if (!query) {
    return c.json({ error: "query is required" }, 400);
  }

  // Placeholder — in production this would search doc_cache with vector similarity
  return c.json({
    results: [],
    query,
    packageName: packageName || null,
    maxResults: maxResults || 10,
  });
});

export default docsRoutes;
