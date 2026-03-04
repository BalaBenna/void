import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { supabaseAdmin } from "../lib/supabase";
import {
  isEmbeddingAvailable,
  semanticSearch,
  backgroundGenerateEmbeddings,
} from "../services/embedding.service";
import type { AppEnv } from "../shared/hono-env";

const embeddings = new Hono<AppEnv>();

// All routes require authentication
embeddings.use("/*", authMiddleware);

// ============================================================
// POST /v1/embeddings/upsert
// Client sends chunks after local BM25 indexing for persistence.
// ============================================================

embeddings.post("/upsert", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    workspaceId: string;
    chunks: Array<{
      chunkId: string;
      fileUri: string;
      content: string;
      symbolName?: string;
      language?: string;
      startLine?: number;
      endLine?: number;
    }>;
  }>();

  if (!body.workspaceId || !body.chunks?.length) {
    return c.json({ error: "workspaceId and chunks are required" }, 400);
  }

  const rows = body.chunks.map((chunk) => ({
    user_id: userId,
    workspace_id: body.workspaceId,
    chunk_id: chunk.chunkId,
    file_uri: chunk.fileUri,
    content: chunk.content,
    symbol_name: chunk.symbolName ?? null,
    language: chunk.language ?? null,
    start_line: chunk.startLine ?? null,
    end_line: chunk.endLine ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("embeddings")
    .upsert(rows, { onConflict: "user_id,workspace_id,chunk_id" });

  if (error) {
    console.error("Embeddings upsert error:", error);
    return c.json({ error: error.message }, 500);
  }

  // Fire-and-forget: generate vector embeddings in the background
  backgroundGenerateEmbeddings(
    body.chunks.map((c) => ({ chunkId: c.chunkId, content: c.content })),
    userId,
    body.workspaceId
  );

  return c.json({ upserted: rows.length });
});

// ============================================================
// DELETE /v1/embeddings/file
// Remove all chunks for a specific file in a workspace.
// ============================================================

embeddings.post("/delete-file", async (c) => {
  const userId = c.get("userId");
  const { workspaceId, fileUri } = await c.req.json<{
    workspaceId: string;
    fileUri: string;
  }>();

  if (!workspaceId || !fileUri) {
    return c.json({ error: "workspaceId and fileUri are required" }, 400);
  }

  const { error } = await supabaseAdmin
    .from("embeddings")
    .delete()
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("file_uri", fileUri);

  if (error) {
    console.error("Embeddings delete error:", error);
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
});

// ============================================================
// GET /v1/embeddings/workspace/:workspaceId
// Fetch all chunks for a workspace (hydrate BM25 index on startup).
// ============================================================

embeddings.get("/workspace/:workspaceId", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.param("workspaceId");

  const { data, error } = await supabaseAdmin
    .from("embeddings")
    .select(
      "chunk_id, file_uri, content, symbol_name, language, start_line, end_line"
    )
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .order("file_uri");

  if (error) {
    console.error("Embeddings fetch error:", error);
    return c.json({ error: error.message }, 500);
  }

  return c.json({ chunks: data });
});

// ============================================================
// DELETE /v1/embeddings/workspace/:workspaceId
// Clear all chunks for a workspace.
// ============================================================

embeddings.delete("/workspace/:workspaceId", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.param("workspaceId");

  const { error } = await supabaseAdmin
    .from("embeddings")
    .delete()
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("Embeddings workspace delete error:", error);
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
});

// ============================================================
// POST /v1/embeddings/search-semantic
// Vector similarity search over stored embeddings.
// Requires OPENAI_API_KEY + pgvector setup in Supabase.
// ============================================================

embeddings.post("/search-semantic", async (c) => {
  if (!isEmbeddingAvailable()) {
    return c.json(
      { error: "Semantic search is not available — OPENAI_API_KEY not configured", code: "PROVIDER_NOT_CONFIGURED" },
      503
    );
  }

  const userId = c.get("userId");
  const body = await c.req.json<{
    workspaceId: string;
    query: string;
    maxResults?: number;
  }>();

  if (!body.workspaceId || !body.query) {
    return c.json({ error: "workspaceId and query are required" }, 400);
  }

  try {
    const results = await semanticSearch(
      userId,
      body.workspaceId,
      body.query,
      body.maxResults ?? 10
    );
    return c.json({ results });
  } catch (error: any) {
    console.error("Semantic search error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export default embeddings;
