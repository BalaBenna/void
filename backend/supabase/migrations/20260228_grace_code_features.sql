-- Grace Code Features: Doc cache, PR analyses, Agent checkpoints

-- Doc cache for auto-indexing
CREATE TABLE IF NOT EXISTS doc_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_name text NOT NULL,
    version text NOT NULL,
    content text NOT NULL,
    embedding vector(1536),
    created_at timestamptz DEFAULT now(),
    UNIQUE(package_name, version)
);

-- PR analyses for BugBot
CREATE TABLE IF NOT EXISTS pr_analyses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    repo text NOT NULL,
    pr_number int NOT NULL,
    analysis jsonb NOT NULL,
    status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now()
);

-- Agent checkpoints
CREATE TABLE IF NOT EXISTS agent_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    thread_id text NOT NULL,
    label text,
    state jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_user_thread ON agent_checkpoints(user_id, thread_id);
