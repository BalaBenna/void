import type { PlanType } from "./types";

// Hono environment bindings for typed context variables
export type AppEnv = {
  Variables: {
    userId: string;
    email: string;
    plan: PlanType;
  };
};
