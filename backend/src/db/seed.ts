import { db, schema } from "./index";

/**
 * Seed the database with test data for local development.
 * Run with: bun run db:seed
 */
async function seed() {
  console.log("Seeding database...");

  // Create a test user
  const [testUser] = await db
    .insert(schema.users)
    .values({
      email: "dev@void.test",
      name: "Dev User",
      avatarUrl: null,
      googleId: "google-test-id-12345",
      plan: "pro",
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning();

  if (testUser) {
    console.log(`  Created test user: ${testUser.email} (${testUser.id})`);

    // Create sample usage data for today
    const today = new Date().toISOString().split("T")[0];
    await db
      .insert(schema.dailyUsage)
      .values({
        userId: testUser.id,
        date: today,
        messagesCount: 12,
        inputTokens: 15000,
        outputTokens: 8500,
      })
      .onConflictDoNothing();

    console.log(`  Created sample usage data for ${today}`);
  } else {
    console.log("  Test user already exists, skipping.");
  }

  console.log("Seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
