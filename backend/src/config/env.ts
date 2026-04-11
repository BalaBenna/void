import { z } from "zod";

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3456),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Database (PostgreSQL — can be Supabase's PostgreSQL)
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/void_dev"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Supabase Auth (required)
  SUPABASE_URL: z.string(),
  SUPABASE_SERVICE_KEY: z.string(),

  // Google OAuth Redirect (Supabase sends Google OAuth callback here)
  GOOGLE_REDIRECT_URI: z
    .string()
    .default("http://localhost:3456/auth/google/callback"),

  // AI Providers
  ANTHROPIC_API_KEY: z.string(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Desktop app deep link protocol
  DESKTOP_PROTOCOL: z.string().default("void"),

  // Frontend URL (for CORS)
  FRONTEND_URL: z.string().default("http://localhost:5173"),
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
