import { Hono } from "hono";

const signalingRoutes = new Hono();

// Simple signaling endpoint for WebRTC pair programming sessions
// In production, this would be a WebSocket upgrade endpoint

// POST /v1/signaling/offer - Send WebRTC offer
signalingRoutes.post("/offer", async (c) => {
  const body = await c.req.json();
  const { sessionId, offer } = body;

  if (!sessionId || !offer) {
    return c.json({ error: "sessionId and offer are required" }, 400);
  }

  // Placeholder — in production this would forward via WebSocket
  return c.json({
    status: "forwarded",
    sessionId,
  });
});

// POST /v1/signaling/answer - Send WebRTC answer
signalingRoutes.post("/answer", async (c) => {
  const body = await c.req.json();
  const { sessionId, answer } = body;

  if (!sessionId || !answer) {
    return c.json({ error: "sessionId and answer are required" }, 400);
  }

  return c.json({
    status: "forwarded",
    sessionId,
  });
});

// POST /v1/signaling/ice - Exchange ICE candidates
signalingRoutes.post("/ice", async (c) => {
  const body = await c.req.json();
  const { sessionId, candidate } = body;

  if (!sessionId || !candidate) {
    return c.json({ error: "sessionId and candidate are required" }, 400);
  }

  return c.json({
    status: "forwarded",
    sessionId,
  });
});

export default signalingRoutes;
