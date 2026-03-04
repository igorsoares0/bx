// Billing plan constants — shared between client and server code.
// This file must NOT import any server-only modules.

export const FREE_PLAN = "Free";
export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";
export const UNLIMITED_PLAN = "Unlimited";

// Paid plans only (registered with Shopify Billing API)
export const PAID_PLANS = [STARTER_PLAN, GROWTH_PLAN, UNLIMITED_PLAN] as const;

// All plans including free tier (for UI display)
export const ALL_PLANS = [FREE_PLAN, STARTER_PLAN, GROWTH_PLAN, UNLIMITED_PLAN] as const;

export const PLAN_PRICES: Record<string, number> = {
  [FREE_PLAN]: 0,
  [STARTER_PLAN]: 12.99,
  [GROWTH_PLAN]: 27.99,
  [UNLIMITED_PLAN]: 47.99,
};

export const PLAN_DESCRIPTIONS: Record<string, string> = {
  [FREE_PLAN]: "Up to $200 in bundle revenue",
  [STARTER_PLAN]: "Up to $1,000 in bundle revenue",
  [GROWTH_PLAN]: "Up to $5,000 in bundle revenue",
  [UNLIMITED_PLAN]: "Unlimited bundle revenue",
};

// Revenue limits in cents per 30-day billing cycle
export const PLAN_LIMITS: Record<string, number> = {
  [FREE_PLAN]: 20_000,        // $200
  [STARTER_PLAN]: 100_000,    // $1,000
  [GROWTH_PLAN]: 500_000,     // $5,000
  [UNLIMITED_PLAN]: Infinity,
};

// Free tier threshold in cents — shops under this don't need a paid plan
export const FREE_TIER_LIMIT = 20_000; // $200
