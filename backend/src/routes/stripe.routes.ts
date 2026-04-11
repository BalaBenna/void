import { Hono } from "hono";
import Stripe from "stripe";
import { env } from "../config/env";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import type { PlanType } from "../shared/types";

const stripeRoutes = new Hono();

// Initialize Stripe (only if key is configured)
const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

// ============================================================
// Price ID -> Plan mapping
// Configure these to match your Stripe product/price IDs
// ============================================================

const PRICE_TO_PLAN: Record<string, PlanType> = {
  // Replace with actual Stripe price IDs
  price_pro_monthly: "pro",
  price_pro_yearly: "pro",
  price_team_monthly: "team",
  price_team_yearly: "team",
  price_enterprise_monthly: "enterprise",
  price_enterprise_yearly: "enterprise",
};

/**
 * Resolve a plan from a Stripe subscription's price ID.
 */
function planFromSubscription(subscription: Stripe.Subscription): PlanType {
  const priceId = subscription.items.data[0]?.price?.id;
  if (priceId && PRICE_TO_PLAN[priceId]) {
    return PRICE_TO_PLAN[priceId];
  }
  return "pro"; // Default to pro for any paid subscription
}

// ============================================================
// POST /stripe/webhook
// Stripe webhook handler -- no auth middleware (uses signature)
// ============================================================

stripeRoutes.post("/webhook", async (c) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const sig = c.req.header("stripe-signature");
  if (!sig) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return c.json({ error: "Invalid signature" }, 400);
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const plan = planFromSubscription(subscription);

        await db
          .update(schema.users)
          .set({
            plan,
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.stripeCustomerId, customerId));

        console.log(
          `Updated subscription for customer ${customerId}: plan=${plan}`
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;

        await db
          .update(schema.users)
          .set({
            plan: "free",
            stripeSubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.stripeCustomerId, customerId));

        console.log(
          `Subscription canceled for customer ${customerId}: downgraded to free`
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

        console.warn(
          `Payment failed for customer ${customerId}, invoice ${invoice.id}`
        );
        break;
      }

      default:
        // Unhandled event type -- ignore silently
        break;
    }
  } catch (err: any) {
    console.error(`Error processing Stripe event ${event.type}:`, err.message);
    return c.json({ error: "Webhook processing failed" }, 500);
  }

  return c.json({ received: true });
});

export default stripeRoutes;
