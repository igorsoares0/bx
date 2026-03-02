import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

/**
 * Public endpoint for storefront widgets to send analytics events.
 * POST /api/analytics
 * Body: { shop, eventType, bundleType, bundleId?, productId? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shop, eventType, bundleType, bundleId, productId } = body;

    if (!shop || !eventType || !bundleType) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    const validEvents = ["view", "click", "add_to_cart"];
    const validTypes = ["tiered", "volume", "complement"];

    if (!validEvents.includes(eventType) || !validTypes.includes(bundleType)) {
      return json({ error: "Invalid eventType or bundleType" }, { status: 400 });
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

    return json({ ok: true }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    console.error("Analytics event error:", e);
    return json({ error: "Internal error" }, {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
};

// Allow CORS from any storefront origin
export const loader = async ({ request }: { request: Request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return json({ error: "Use POST" }, { status: 405 });
};
