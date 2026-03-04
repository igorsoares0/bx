import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Divider,
  Box,
  List,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  FREE_PLAN,
  STARTER_PLAN,
  GROWTH_PLAN,
  UNLIMITED_PLAN,
  PAID_PLANS,
  PLAN_PRICES,
  PLAN_DESCRIPTIONS,
  PLAN_LIMITS,
} from "../lib/plans";
import { getMonthlyBundleRevenue } from "../lib/billing.server";

const PLAN_FEATURES: Record<string, string[]> = {
  [FREE_PLAN]: [
    "All bundle types (FBT, Tiered, Volume)",
    "Up to $200/mo in bundle revenue",
    "Full analytics dashboard",
    "Theme extension included",
  ],
  [STARTER_PLAN]: [
    "All bundle types (FBT, Tiered, Volume)",
    "Up to $1,000/mo in bundle revenue",
    "Full analytics dashboard",
    "Theme extension included",
    "14-day free trial",
  ],
  [GROWTH_PLAN]: [
    "All bundle types (FBT, Tiered, Volume)",
    "Up to $5,000/mo in bundle revenue",
    "Full analytics dashboard",
    "Theme extension included",
    "14-day free trial",
  ],
  [UNLIMITED_PLAN]: [
    "All bundle types (FBT, Tiered, Volume)",
    "Unlimited bundle revenue",
    "Full analytics dashboard",
    "Theme extension included",
    "Priority support",
    "14-day free trial",
  ],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let currentPlan: string | null = null;
  try {
    const response = await admin.graphql(
      `#graphql
        query {
          currentAppInstallation {
            activeSubscriptions {
              name
            }
          }
        }`,
    );
    const data = await response.json();
    const subs = data?.data?.currentAppInstallation?.activeSubscriptions || [];
    if (subs.length > 0 && PAID_PLANS.includes(subs[0].name as any)) {
      currentPlan = subs[0].name;
    }
  } catch {
    // No active plan
  }

  // No paid plan = Free tier
  if (!currentPlan) currentPlan = FREE_PLAN;

  const monthlyRevenue = await getMonthlyBundleRevenue(session.shop);

  return json({ currentPlan, monthlyRevenue });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;

  if (!PAID_PLANS.includes(plan as any)) {
    return json({ error: "Invalid plan" }, { status: 400 });
  }

  await billing.request({
    plan,
    isTest: process.env.NODE_ENV !== "production",
  });

  return null;
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function suggestedPlan(revenueCents: number): string {
  if (revenueCents <= PLAN_LIMITS[STARTER_PLAN]) return STARTER_PLAN;
  if (revenueCents <= PLAN_LIMITS[GROWTH_PLAN]) return GROWTH_PLAN;
  return UNLIMITED_PLAN;
}

export default function SelectPlanPage() {
  const { currentPlan, monthlyRevenue } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const recommended = suggestedPlan(monthlyRevenue);
  const isOnFreePlan = currentPlan === FREE_PLAN;
  const freeOverLimit = isOnFreePlan && monthlyRevenue >= PLAN_LIMITS[FREE_PLAN];

  const handleSelectPlan = (plan: string) => {
    const formData = new FormData();
    formData.set("plan", plan);
    submit(formData, { method: "post" });
  };

  const allDisplayPlans = [FREE_PLAN, ...PAID_PLANS];

  return (
    <Page title="Choose your plan" narrowWidth>
      <BlockStack gap="400">
        {freeOverLimit && (
          <Banner
            title="Free tier limit reached"
            tone="warning"
          >
            <p>
              Your bundle revenue this month ({formatCurrency(monthlyRevenue)}) has exceeded
              the free tier limit of {formatCurrency(PLAN_LIMITS[FREE_PLAN])}.
              Choose a paid plan to continue creating bundles.
            </p>
          </Banner>
        )}

        {monthlyRevenue > 0 && !freeOverLimit && (
          <Box paddingBlockEnd="200">
            <Text as="p" variant="bodySm" tone="subdued">
              Your current monthly bundle revenue: {formatCurrency(monthlyRevenue)}
            </Text>
          </Box>
        )}

        <InlineStack gap="400" align="center" wrap>
          {allDisplayPlans.map((plan) => {
            const isCurrent = currentPlan === plan;
            const isFree = plan === FREE_PLAN;
            const isRecommended = !isCurrent && !isFree && plan === recommended;

            return (
              <Box key={plan} minWidth="240px" maxWidth="280px">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        {plan}
                      </Text>
                      {isCurrent && <Badge tone="success">Current</Badge>}
                      {isRecommended && <Badge tone="info">Recommended</Badge>}
                    </InlineStack>

                    <BlockStack gap="100">
                      <InlineStack blockAlign="baseline" gap="100">
                        <Text as="span" variant="heading2xl">
                          {isFree ? "Free" : `$${PLAN_PRICES[plan]}`}
                        </Text>
                        {!isFree && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            /month
                          </Text>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {PLAN_DESCRIPTIONS[plan]}
                      </Text>
                    </BlockStack>

                    <Divider />

                    <List>
                      {PLAN_FEATURES[plan].map((feature, i) => (
                        <List.Item key={i}>{feature}</List.Item>
                      ))}
                    </List>

                    {isFree ? (
                      <Button
                        size="large"
                        fullWidth
                        disabled
                      >
                        {isCurrent ? "Current plan" : "Free"}
                      </Button>
                    ) : (
                      <Button
                        variant={isRecommended ? "primary" : undefined}
                        size="large"
                        fullWidth
                        disabled={isCurrent || isSubmitting}
                        onClick={() => handleSelectPlan(plan)}
                        loading={isSubmitting}
                      >
                        {isCurrent
                          ? "Current plan"
                          : isOnFreePlan
                            ? "Start 14-day free trial"
                            : `Switch to ${plan}`}
                      </Button>
                    )}
                  </BlockStack>
                </Card>
              </Box>
            );
          })}
        </InlineStack>

        <Box paddingBlockStart="400">
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Start free with up to $200/mo in bundle revenue. Paid plans include a
            14-day free trial. Cancel anytime.
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
