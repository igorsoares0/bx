import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

// ── In-memory rate limiter: 60 requests/min per shop ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (val.resetAt < now) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

function checkRateLimit(shop: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(shop);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(shop, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Public endpoint for storefront widgets to send analytics events.
 * POST /api/analytics
 * Body (JSON as text/plain): { shop, eventType, bundleType, bundleId?, productId? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const raw = await request.text();
    const body = JSON.parse(raw);
    const { shop, eventType, bundleType, bundleId, productId } = body;

    if (!shop || !eventType || !bundleType) {
      return json({ error: "Missing required fields" }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const validEvents = ["view"];
    const validTypes = ["tiered", "volume", "complement"];

    if (!validEvents.includes(eventType) || !validTypes.includes(bundleType)) {
      return json({ error: "Invalid eventType or bundleType" }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate shop exists in our DB
    const session = await db.session.findFirst({ where: { shop } });
    if (!session) {
      return json({ error: "Unknown shop" }, {
        status: 403,
        headers: CORS_HEADERS,
      });
    }

    // Rate limit check
    if (!checkRateLimit(shop)) {
      return json({ error: "Too many requests" }, {
        status: 429,
        headers: { ...CORS_HEADERS, "Retry-After": "60" },
      });
    }

    await db.bundleEvent.create({
      data: {
        shopId: shop,
        eventType,
        bundleType,
        bundleId: bundleId ? Number(bundleId) : null,
        productId: productId || null,
      },
    });

    return json({ ok: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("Analytics event error:", e);
    return json({ error: "Internal error" }, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
};

// GET requests return 405
export const loader = async () => {
  return json({ error: "Use POST" }, { status: 405, headers: CORS_HEADERS });
};
