import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.middleware";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { type PlanType, PLAN_LIMITS, ERROR_CODES } from "../shared/types";

type Env = {
  Variables: {
    userId: string;
    email: string;
    plan: string;
  };
};

const projectRoutes = new Hono<Env>();

// All routes require authentication
projectRoutes.use("/*", authMiddleware);

function formatProject(p: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ============================================================
// GET /v1/projects - List user's active projects
// ============================================================

projectRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const userProjects = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, userId),
        eq(schema.projects.isActive, true)
      )
    );

  return c.json({
    projects: userProjects.map(formatProject),
  });
});

// ============================================================
// POST /v1/projects - Create a new project
// ============================================================

projectRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const plan = c.get("plan") as PlanType;
  const body = await c.req.json<{ name: string; description?: string }>();

  if (!body.name || body.name.trim().length === 0) {
    return c.json(
      { error: "Project name is required", code: ERROR_CODES.INVALID_REQUEST },
      400
    );
  }

  // Check project limit
  const limits = PLAN_LIMITS[plan];
  if (limits.maxProjects !== -1) {
    const existing = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.userId, userId),
          eq(schema.projects.isActive, true)
        )
      );

    if (existing.length >= limits.maxProjects) {
      return c.json(
        {
          error: `Project limit reached (${limits.maxProjects} for ${plan} plan)`,
          code: ERROR_CODES.PLAN_LIMIT_EXCEEDED,
        },
        403
      );
    }
  }

  const [project] = await db
    .insert(schema.projects)
    .values({
      userId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
    })
    .returning();

  return c.json(formatProject(project), 201);
});

// ============================================================
// GET /v1/projects/:id - Get a single project
// ============================================================

projectRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.projects.isActive, true)
      )
    );

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(formatProject(project));
});

// ============================================================
// PUT /v1/projects/:id - Update a project
// ============================================================

projectRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const body = await c.req.json<{ name?: string; description?: string }>();

  const [existing] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.projects.isActive, true)
      )
    );

  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined)
    updates.description = body.description?.trim() || null;

  const [updated] = await db
    .update(schema.projects)
    .set(updates)
    .where(eq(schema.projects.id, projectId))
    .returning();

  return c.json(formatProject(updated));
});

// ============================================================
// DELETE /v1/projects/:id - Soft-delete a project
// ============================================================

projectRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");

  const [existing] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.projects.isActive, true)
      )
    );

  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  await db
    .update(schema.projects)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));

  return c.json({ message: "Project deleted" });
});

export default projectRoutes;
