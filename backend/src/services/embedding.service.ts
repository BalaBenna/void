import OpenAI from "openai";
import { env } from "../config/env";
import { supabaseAdmin } from "../lib/supabase";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured — embeddings unavailable");
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export function isEmbeddingAvailable(): boolean {
  return !!env.OPENAI_API_KEY;
}

/**
 * Generate a vector embedding for the given text using OpenAI text-embedding-3-small (1536 dims).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single batch call.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Perform semantic (vector similarity) search over stored embeddings.
 * Requires pgvector extension + `match_embeddings` RPC function in Supabase.
 */
export async function semanticSearch(
  userId: string,
  workspaceId: string,
  query: string,
  maxResults: number = 10
): Promise<Array<{
  chunkId: string;
  fileUri: string;
  content: string;
  symbolName: string | null;
  similarity: number;
}>> {
  const queryEmbedding = await generateEmbedding(query);

  const { data, error } = await supabaseAdmin.rpc("match_embeddings", {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_workspace_id: workspaceId,
    match_count: maxResults,
  });

  if (error) {
    throw new Error(`Semantic search failed: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    chunkId: row.chunk_id,
    fileUri: row.file_uri,
    content: row.content,
    symbolName: row.symbol_name,
    similarity: row.similarity,
  }));
}

/**
 * Fire-and-forget: generate embeddings for chunks and store them in Supabase.
 * Silently swallows errors so it doesn't block the upsert response.
 */
export function backgroundGenerateEmbeddings(
  chunks: Array<{ chunkId: string; content: string }>,
  userId: string,
  workspaceId: string
): void {
  if (!isEmbeddingAvailable()) return;

  (async () => {
    try {
      const texts = chunks.map((c) => c.content);
      const embeddings = await generateEmbeddingsBatch(texts);

      for (let i = 0; i < chunks.length; i++) {
        const { error } = await supabaseAdmin
          .from("embeddings")
          .update({ embedding: JSON.stringify(embeddings[i]) })
          .eq("user_id", userId)
          .eq("workspace_id", workspaceId)
          .eq("chunk_id", chunks[i].chunkId);

        if (error) {
          console.error(`Embedding update failed for ${chunks[i].chunkId}:`, error.message);
        }
      }
    } catch (err: any) {
      console.error("Background embedding generation failed:", err.message);
    }
  })();
}
