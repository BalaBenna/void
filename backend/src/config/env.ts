import { z } from "zod";

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3456),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Backend URL (for constructing OAuth callback URL)
  BACKEND_URL: z.string().default("http://localhost:3456"),

  // Redis (rate limiting + caching)
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // AI Providers
  ANTHROPIC_API_KEY: z.string(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // E2B Cloud Sandbox
  E2B_API_KEY: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Desktop app deep link protocol
  DESKTOP_PROTOCOL: z.string().default("void"),

  // Frontend URL (for CORS + web flow redirect)
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  // GitHub Integration (BugBot, @PR, @issue)
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Linear Integration (optional, for @issue)
  LINEAR_API_KEY: z.string().optional(),

  // Code Embeddings (optional, falls back to OPENAI_API_KEY)
  VOYAGE_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error("Invalid environment variables:");
  console.error(error);
  process.exit(1);
}

export { env };
