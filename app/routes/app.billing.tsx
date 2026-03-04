import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Divider,
  Box,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  FREE_PLAN,
  UNLIMITED_PLAN,
  PAID_PLANS,
  PLAN_PRICES,
  PLAN_DESCRIPTIONS,
} from "../lib/plans";
import { getShopBillingStatus } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const billingStatus = await getShopBillingStatus(admin, session.shop);
  return json({ billingStatus });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "change-plan") {
    const plan = formData.get("plan") as string;
    if (!PAID_PLANS.includes(plan as any)) {
      return json({ error: "Invalid plan" }, { status: 400 });
    }
    await billing.request({
      plan,
      isTest: process.env.NODE_ENV !== "production",
    });
    return null;
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    if (!subscriptionId) {
      return json({ error: "No subscription to cancel" }, { status: 400 });
    }
    await billing.cancel({
      subscriptionId,
      isTest: process.env.NODE_ENV !== "production",
      prorate: true,
    });
    return json({ ok: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function BillingPage() {
  const { billingStatus } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleChangePlan = (plan: string) => {
    const formData = new FormData();
    formData.set("intent", "change-plan");
    formData.set("plan", plan);
    submit(formData, { method: "post" });
  };

  const handleCancel = () => {
    if (!billingStatus.subscriptionId) return;
    const formData = new FormData();
    formData.set("intent", "cancel");
    formData.set("subscriptionId", billingStatus.subscriptionId);
    submit(formData, { method: "post" });
  };

  const revenueFormatted = formatCurrency(billingStatus.monthlyRevenue);
  const isOnFreePlan = billingStatus.currentPlan === FREE_PLAN;
  const limitFormatted = billingStatus.revenueLimit === Infinity
    ? "Unlimited"
    : formatCurrency(billingStatus.revenueLimit);
  const progressValue = billingStatus.revenueLimit === Infinity
    ? 0
    : Math.min(billingStatus.usagePercent, 100);

  return (
    <Page title="Billing & Plan" backAction={{ url: "/app" }}>
      <Layout>
        {/* Current Plan */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Current Plan
                </Text>
                <Badge tone={isOnFreePlan ? "info" : "success"}>
                  {billingStatus.currentPlan}
                </Badge>
              </InlineStack>

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Monthly price
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {isOnFreePlan ? "Free" : `$${PLAN_PRICES[billingStatus.currentPlan]}/mo`}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Revenue limit
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {PLAN_DESCRIPTIONS[billingStatus.currentPlan]}
                  </Text>
                </InlineStack>
              </BlockStack>

              {billingStatus.isTrialing && !isOnFreePlan && (
                <Banner tone="info">
                  <p>You are currently on a free trial.</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Revenue Usage */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Monthly Bundle Revenue
              </Text>

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">
                    {revenueFormatted}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    of {limitFormatted}
                  </Text>
                </InlineStack>

                {billingStatus.revenueLimit !== Infinity && (
                  <ProgressBar
                    progress={progressValue}
                    tone={
                      billingStatus.isOverLimit
                        ? "critical"
                        : billingStatus.isNearLimit
                          ? "highlight"
                          : "primary"
                    }
                    size="small"
                  />
                )}

                <Text as="p" variant="bodySm" tone="subdued">
                  {billingStatus.revenueLimit === Infinity
                    ? "Your plan has no revenue limit."
                    : `${billingStatus.usagePercent}% of your plan limit used this billing period.`}
                </Text>
              </BlockStack>

              {billingStatus.isOverLimit && isOnFreePlan && (
                <Banner
                  tone="critical"
                  action={{ content: "Upgrade now", url: "/app/select-plan" }}
                >
                  <p>
                    You've exceeded the free tier limit of $200/mo. Upgrade to a paid plan to
                    continue creating new bundles.
                  </p>
                </Banner>
              )}
              {billingStatus.isOverLimit && !isOnFreePlan && (
                <Banner tone="critical">
                  <p>
                    You've exceeded your plan limit. Upgrade to continue creating new bundles.
                  </p>
                </Banner>
              )}
              {billingStatus.isNearLimit && !billingStatus.isOverLimit && (
                <Banner tone="warning">
                  <p>
                    You're approaching your plan limit.{" "}
                    {isOnFreePlan
                      ? "Consider upgrading to a paid plan."
                      : "Consider upgrading to avoid interruptions."}
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Available Plans */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {isOnFreePlan ? "Upgrade to a Paid Plan" : "Change Plan"}
              </Text>

              {PAID_PLANS.map((plan) => {
                const isCurrent = billingStatus.currentPlan === plan;
                return (
                  <Box key={plan}>
                    <InlineStack align="space-between" blockAlign="center" gap="400">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="headingSm">
                            {plan}
                          </Text>
                          {isCurrent && <Badge tone="success">Current</Badge>}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ${PLAN_PRICES[plan]}/mo — {PLAN_DESCRIPTIONS[plan]}
                        </Text>
                      </BlockStack>
                      <Button
                        disabled={isCurrent || isSubmitting}
                        onClick={() => handleChangePlan(plan)}
                        loading={isSubmitting}
                        variant={!isCurrent ? "primary" : undefined}
                      >
                        {isCurrent
                          ? "Current"
                          : isOnFreePlan
                            ? "Start 14-day trial"
                            : "Switch"}
                      </Button>
                    </InlineStack>
                    {plan !== UNLIMITED_PLAN && <Divider />}
                  </Box>
                );
              })}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Cancel — only for paid plans */}
        {!isOnFreePlan && billingStatus.subscriptionId && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Cancel Subscription
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Cancelling will prorate your remaining balance. Your bundles will stop
                  receiving automatic discounts when the subscription ends.
                </Text>
                <InlineStack align="end">
                  <Button
                    tone="critical"
                    disabled={isSubmitting}
                    loading={isSubmitting}
                    onClick={handleCancel}
                  >
                    Cancel subscription
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
