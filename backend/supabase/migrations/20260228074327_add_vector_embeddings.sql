-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to the existing embeddings table
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS embeddings_embedding_idx
  ON embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC function for semantic search (cosine similarity)
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_user_id text,
  match_workspace_id text,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id text,
  file_uri text,
  content text,
  symbol_name text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.chunk_id,
    e.file_uri,
    e.content,
    e.symbol_name,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.user_id = match_user_id
    AND e.workspace_id = match_workspace_id
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
