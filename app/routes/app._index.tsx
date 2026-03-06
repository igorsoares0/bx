import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useOutletContext } from "@remix-run/react";
import {
  Page,
  Text,
  Badge,
  Banner,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Button,
  ButtonGroup,
  Divider,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  ProductIcon,
  DiscountIcon,
  OrderIcon,
  DeleteIcon,
  PlayCircleIcon,
  PauseCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { BillingStatus } from "../lib/billing.server";
import { getShopBillingStatus, parseProductIds } from "../lib/billing.server";
import {
  removeTieredBundleMetafield,
  setTieredBundleMetafield,
  setShopTieredBundleMetafield,
  removeVolumeBundleMetafield,
  setVolumeBundleMetafield,
  setShopVolumeBundleMetafield,
  removeComplementBundleMetafield,
  setComplementBundleMetafield,
  setShopComplementBundleMetafield,
} from "../lib/bundle-metafields.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [tieredBundles, volumeBundles, complementBundles] = await Promise.all([
    db.tieredBundle.findMany({
      where: { shopId: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    db.volumeBundle.findMany({
      where: { shopId: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    db.complementBundle.findMany({
      where: { shopId: session.shop },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return json({ tieredBundles, volumeBundles, complementBundles });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const bundleId = Number(formData.get("bundleId"));
  const bundleType = (formData.get("bundleType") as string) || "classic";

  // Block reactivation when over billing limit
  if (intent === "toggle") {
    const billingStatus = await getShopBillingStatus(admin, session.shop);
    // We need to check the bundle's current state — only block if activating (not deactivating)
    let isCurrentlyActive = false;
    if (bundleType === "tiered") {
      const b = await db.tieredBundle.findFirst({ where: { id: bundleId, shopId: session.shop } });
      isCurrentlyActive = b?.active ?? false;
    } else if (bundleType === "volume") {
      const b = await db.volumeBundle.findFirst({ where: { id: bundleId, shopId: session.shop } });
      isCurrentlyActive = b?.active ?? false;
    } else if (bundleType === "complement") {
      const b = await db.complementBundle.findFirst({ where: { id: bundleId, shopId: session.shop } });
      isCurrentlyActive = b?.active ?? false;
    }
    // If trying to activate (currently inactive) and over limit, block it
    if (!isCurrentlyActive && billingStatus.isOverLimit) {
      return json(
        { error: "Cannot activate bundle: revenue limit exceeded. Please upgrade your plan." },
        { status: 403 },
      );
    }
  }

  if (bundleType === "tiered") {
    if (intent === "delete") {
      const bundle = await db.tieredBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticDelete($id: ID!) {
                discountAutomaticDelete(id: $id) {
                  deletedAutomaticDiscountId
                  userErrors { field message }
                }
              }`,
            { variables: { id: bundle.discountId } },
          );
        }
        const productIds = parseProductIds(bundle.productId);
        if (productIds.length > 0) {
          await removeTieredBundleMetafield(admin, productIds, bundle.id);
        }
        await db.tieredBundle.delete({ where: { id: bundleId } });
        await setShopTieredBundleMetafield(admin, session.shop, db);
      }
    }

    if (intent === "toggle") {
      const bundle = await db.tieredBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        const newActive = !bundle.active;
        await db.tieredBundle.update({
          where: { id: bundleId },
          data: { active: newActive },
        });

        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
                discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
                  userErrors { field message }
                }
              }`,
            {
              variables: {
                id: bundle.discountId,
                automaticAppDiscount: {
                  startsAt: newActive ? new Date().toISOString() : null,
                  endsAt: newActive ? null : new Date().toISOString(),
                },
              },
            },
          );
        }

        if (!newActive) {
          const productIds = parseProductIds(bundle.productId);
          if (productIds.length > 0) {
            await removeTieredBundleMetafield(admin, productIds, bundle.id);
          }
        } else {
          // Restore product metafields on reactivation
          if (bundle.triggerType === "product" || !bundle.triggerType) {
            const productIds = parseProductIds(bundle.productId);
            if (productIds.length > 0) {
              let tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }> = [];
              try { tiers = JSON.parse(bundle.tiersConfig || "[]"); } catch {}
              const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
              await setTieredBundleMetafield(admin, {
                bundleId: bundle.id,
                productIds,
                bundleName: bundle.name,
                tiers,
                designConfig,
              });
            }
          }
        }
        await setShopTieredBundleMetafield(admin, session.shop, db);
      }
    }

    return json({ ok: true });
  }

  if (bundleType === "volume") {
    if (intent === "delete") {
      const bundle = await db.volumeBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticDelete($id: ID!) {
                discountAutomaticDelete(id: $id) {
                  deletedAutomaticDiscountId
                  userErrors { field message }
                }
              }`,
            { variables: { id: bundle.discountId } },
          );
        }
        const productIds = parseProductIds(bundle.productId);
        if (productIds.length > 0) {
          await removeVolumeBundleMetafield(admin, productIds, bundle.id);
        }
        await db.volumeBundle.delete({ where: { id: bundleId } });
        // Refresh shop-level metafield
        await setShopVolumeBundleMetafield(admin, session.shop, db);
      }
    }

    if (intent === "toggle") {
      const bundle = await db.volumeBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        const newActive = !bundle.active;
        await db.volumeBundle.update({
          where: { id: bundleId },
          data: { active: newActive },
        });

        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
                discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
                  userErrors { field message }
                }
              }`,
            {
              variables: {
                id: bundle.discountId,
                automaticAppDiscount: {
                  startsAt: newActive ? new Date().toISOString() : null,
                  endsAt: newActive ? null : new Date().toISOString(),
                },
              },
            },
          );
        }

        if (!newActive) {
          const productIds = parseProductIds(bundle.productId);
          if (productIds.length > 0) {
            await removeVolumeBundleMetafield(admin, productIds, bundle.id);
          }
        } else {
          // Restore product metafields on reactivation
          if (bundle.triggerType === "product" || !bundle.triggerType) {
            const productIds = parseProductIds(bundle.productId);
            if (productIds.length > 0) {
              let volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }> = [];
              try { volumeTiers = JSON.parse(bundle.volumeTiers || "[]"); } catch {}
              const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
              await setVolumeBundleMetafield(admin, {
                bundleId: bundle.id,
                productIds,
                bundleName: bundle.name,
                volumeTiers,
                designConfig,
              });
            }
          }
        }
        // Refresh shop-level metafield
        await setShopVolumeBundleMetafield(admin, session.shop, db);
      }
    }

    return json({ ok: true });
  }

  if (bundleType === "complement") {
    if (intent === "delete") {
      const bundle = await db.complementBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticDelete($id: ID!) {
                discountAutomaticDelete(id: $id) {
                  deletedAutomaticDiscountId
                  userErrors { field message }
                }
              }`,
            { variables: { id: bundle.discountId } },
          );
        }
        if (bundle.triggerType === "product" && bundle.triggerReference) {
          await removeComplementBundleMetafield(admin, bundle.triggerReference, bundle.id);
        }
        await db.complementBundle.delete({ where: { id: bundleId } });
        await setShopComplementBundleMetafield(admin, session.shop, db);
      }
    }

    if (intent === "toggle") {
      const bundle = await db.complementBundle.findFirst({
        where: { id: bundleId, shopId: session.shop },
      });
      if (bundle) {
        const newActive = !bundle.active;
        await db.complementBundle.update({
          where: { id: bundleId },
          data: { active: newActive },
        });

        if (bundle.discountId) {
          await admin.graphql(
            `#graphql
              mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
                discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
                  userErrors { field message }
                }
              }`,
            {
              variables: {
                id: bundle.discountId,
                automaticAppDiscount: {
                  startsAt: newActive ? new Date().toISOString() : null,
                  endsAt: newActive ? null : new Date().toISOString(),
                },
              },
            },
          );
        }

        if (!newActive && bundle.triggerType === "product" && bundle.triggerReference) {
          await removeComplementBundleMetafield(admin, bundle.triggerReference, bundle.id);
        } else if (newActive && bundle.triggerType === "product" && bundle.triggerReference) {
          // Restore product metafield on reactivation
          let complements: Array<any> = [];
          try { complements = JSON.parse(bundle.complements || "[]"); } catch {}
          const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
          await setComplementBundleMetafield(admin, {
            bundleId: bundle.id,
            productId: bundle.triggerReference,
            bundleName: bundle.name,
            complements,
            designConfig,
            mode: (bundle as any).mode || "fbt",
            triggerDiscountPct: (bundle as any).triggerDiscountPct || 0,
          });
        }
        await setShopComplementBundleMetafield(admin, session.shop, db);
      }
    }

    return json({ ok: true });
  }

  return json({ ok: true });
};

function BundleTypeCard({
  icon,
  title,
  description,
  badge,
  badgeTone,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: typeof ProductIcon;
  title: string;
  description: string;
  badge: string;
  badgeTone: "info" | "warning" | "success";
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  badgeTone === "info"
                    ? "var(--p-color-bg-fill-info-secondary)"
                    : badgeTone === "warning"
                      ? "var(--p-color-bg-fill-caution-secondary)"
                      : "var(--p-color-bg-fill-success-secondary)",
              }}
            >
              <Icon source={icon} />
            </div>
            <Text variant="headingSm" as="h3">
              {title}
            </Text>
          </InlineStack>
          <Badge tone={badgeTone}>{badge}</Badge>
        </InlineStack>
        <Text variant="bodySm" as="p" tone="subdued">
          {description}
        </Text>
        <Button onClick={onAction} disabled={disabled} size="slim">
          {actionLabel}
        </Button>
      </BlockStack>
    </Card>
  );
}

function BundleRow({
  name,
  active,
  badge,
  badgeTone,
  detail,
  condition,
  onEdit,
  onToggle,
  onDelete,
  toggleDisabled,
}: {
  name: string;
  active: boolean;
  badge: string;
  badgeTone: "info" | "warning" | "success" | "magic";
  detail: string;
  condition: string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  toggleDisabled?: boolean;
}) {
  return (
    <Box paddingBlockStart="300" paddingBlockEnd="300">
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <div
          style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
          onClick={onEdit}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onEdit()}
        >
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <div style={{ minWidth: 0 }}>
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodyMd" fontWeight="semibold" as="span" truncate>
                  {name}
                </Text>
                <Badge tone={badgeTone}>{badge}</Badge>
                <Badge tone={active ? "success" : undefined}>
                  {active ? "Active" : "Inactive"}
                </Badge>
              </InlineStack>
              <Box paddingBlockStart="050">
                <Text variant="bodySm" as="span" tone="subdued">
                  {condition} · {detail}
                </Text>
              </Box>
            </div>
          </InlineStack>
        </div>
        <ButtonGroup>
          <Button
            onClick={onToggle}
            disabled={toggleDisabled}
            size="slim"
            icon={active ? PauseCircleIcon : PlayCircleIcon}
            accessibilityLabel={active ? "Deactivate" : "Activate"}
          />
          <Button
            onClick={onDelete}
            size="slim"
            tone="critical"
            icon={DeleteIcon}
            accessibilityLabel="Delete"
          />
        </ButtonGroup>
      </InlineStack>
    </Box>
  );
}

function getTieredCondition(bundle: { triggerType?: string; productId: string }) {
  const tt = bundle.triggerType || "product";
  if (tt === "all") return "All products";
  if (tt === "collection") return "Collection";
  try {
    const ids = JSON.parse(bundle.productId || "[]");
    if (Array.isArray(ids)) return `${ids.length} product${ids.length !== 1 ? "s" : ""}`;
  } catch {}
  return "1 product";
}

function getTieredDetail(tiersConfig: string) {
  try {
    const t = JSON.parse(tiersConfig || "[]") as Array<{ buyQty: number; freeQty: number }>;
    return t.map((tier) => `Buy ${tier.buyQty} Get ${tier.freeQty}`).join(", ");
  } catch {
    return "—";
  }
}

function getVolumeCondition(bundle: { triggerType?: string; productId: string }) {
  const tt = bundle.triggerType || "product";
  if (tt === "all") return "All products";
  if (tt === "collection") return "Collection";
  try {
    const parsed = JSON.parse(bundle.productId || "[]");
    const ids = Array.isArray(parsed) ? parsed : [bundle.productId];
    return `${ids.length} product${ids.length !== 1 ? "s" : ""}`;
  } catch {
    return "1 product";
  }
}

function getVolumeDetail(volumeTiers: string) {
  try {
    const t = JSON.parse(volumeTiers || "[]") as Array<{ label: string; qty: number; discountPct: number }>;
    return t.map((tier) => `${tier.label || tier.qty + "x"} (${tier.discountPct}% off)`).join(", ");
  } catch {
    return "—";
  }
}

function getComplementCondition(bundle: { triggerType: string }) {
  if (bundle.triggerType === "product") return "Specific product";
  if (bundle.triggerType === "collection") return "Collection";
  return "All products";
}

function getComplementDetail(complements: string) {
  try {
    const c = JSON.parse(complements || "[]");
    return `${c.length} complement${c.length !== 1 ? "s" : ""}`;
  } catch {
    return "—";
  }
}

export default function BundleIndex() {
  const { tieredBundles, volumeBundles, complementBundles } = useLoaderData<typeof loader>();
  const { billingStatus } = useOutletContext<{ billingStatus: BillingStatus }>();
  const navigate = useNavigate();
  const submit = useSubmit();

  const handleDelete = (id: number, type: "tiered" | "volume" | "complement") => {
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("bundleId", String(id));
    formData.set("bundleType", type);
    submit(formData, { method: "post" });
  };

  const handleToggle = (id: number, type: "tiered" | "volume" | "complement") => {
    const formData = new FormData();
    formData.set("intent", "toggle");
    formData.set("bundleId", String(id));
    formData.set("bundleType", type);
    submit(formData, { method: "post" });
  };

  const hasNoBundles =
    tieredBundles.length === 0 && volumeBundles.length === 0 && complementBundles.length === 0;

  const formatRevenue = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  const isOverLimit = billingStatus?.isOverLimit;

  return (
    <Page title="Bundles">
      <BlockStack gap="400">
        {/* Billing banners */}
        {billingStatus?.isOverLimit && (
          <Banner
            title={
              billingStatus.currentPlan === "Free"
                ? "Free tier limit reached"
                : "Bundle revenue limit reached"
            }
            tone="critical"
            action={{
              content: billingStatus.currentPlan === "Free" ? "Upgrade now" : "Upgrade plan",
              url: "/app/select-plan",
            }}
          >
            <p>
              {billingStatus.currentPlan === "Free"
                ? `Your bundle revenue this month (${formatRevenue(billingStatus.monthlyRevenue)}) has exceeded the free tier limit of $200. All bundles have been deactivated. Upgrade to a paid plan to reactivate them.`
                : `Your bundle revenue this month (${formatRevenue(billingStatus.monthlyRevenue)}) has exceeded your ${billingStatus.currentPlan} plan limit (${formatRevenue(billingStatus.revenueLimit)}). All bundles have been deactivated. Upgrade your plan to reactivate them.`}
            </p>
          </Banner>
        )}
        {billingStatus?.isNearLimit && !billingStatus?.isOverLimit && (
          <Banner
            title="Approaching revenue limit"
            tone="warning"
            action={{ content: "View plans", url: "/app/billing" }}
          >
            <p>
              You've used {billingStatus.usagePercent}% of your {billingStatus.currentPlan} plan
              limit ({formatRevenue(billingStatus.monthlyRevenue)} /{" "}
              {formatRevenue(billingStatus.revenueLimit)}).
              {billingStatus.currentPlan === "Free"
                ? " Consider upgrading to a paid plan."
                : " Consider upgrading to avoid interruptions."}
            </p>
          </Banner>
        )}

        {/* Bundle type cards — always visible as creation shortcuts */}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <BundleTypeCard
            icon={ProductIcon}
            title="FBT / Combo"
            badge="Popular"
            badgeTone="success"
            description="Recommend complementary products on the product page. Show a 'Frequently Bought Together' widget or combo deals with discounts on each item."
            actionLabel="Create FBT bundle"
            onAction={() => navigate("/app/complement/new")}
            disabled={isOverLimit}
          />
          <BundleTypeCard
            icon={OrderIcon}
            title="Tiered Combo"
            badge="BOGO"
            badgeTone="info"
            description="Set up 'Buy X Get Y' deals with multiple tiers. For example: Buy 1 Get 1, Buy 2 Get 3, Buy 3 Get 6 — great for increasing average order value."
            actionLabel="Create tiered combo"
            onAction={() => navigate("/app/tiers/new")}
            disabled={isOverLimit}
          />
          <BundleTypeCard
            icon={DiscountIcon}
            title="Volume Discount"
            badge="Qty"
            badgeTone="warning"
            description="Offer increasing discounts based on quantity. For example: 1 unit at full price, 2 units at 15% off, 3 units at 25% off — encourages bulk purchases."
            actionLabel="Create volume discount"
            onAction={() => navigate("/app/volume/new")}
            disabled={isOverLimit}
          />
        </InlineGrid>

        {/* Bundle lists */}
        {hasNoBundles ? (
          <Card>
            <Box paddingBlock="800">
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd" as="h2" alignment="center">
                  No bundles yet
                </Text>
                <Text variant="bodySm" as="p" tone="subdued" alignment="center">
                  Choose a bundle type above to create your first offer and start boosting sales.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <>
            {/* FBT / Complement bundles */}
            {complementBundles.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingSm" as="h2">
                        FBT / Combo bundles
                      </Text>
                      <Badge tone="success">{String(complementBundles.length)}</Badge>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/complement/new")}
                      disabled={isOverLimit}
                      size="slim"
                    >
                      Add
                    </Button>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="0">
                    {complementBundles.map((bundle, i) => (
                      <div key={`complement-${bundle.id}`}>
                        <BundleRow
                          name={bundle.name}
                          active={bundle.active}
                          badge={(bundle as any).mode === "combo" ? "Combo" : "FBT"}
                          badgeTone={(bundle as any).mode === "combo" ? "success" : "magic"}
                          condition={getComplementCondition(bundle)}
                          detail={getComplementDetail(bundle.complements)}
                          onEdit={() => navigate(`/app/complement/${bundle.id}`)}
                          onToggle={() => handleToggle(bundle.id, "complement")}
                          onDelete={() => handleDelete(bundle.id, "complement")}
                          toggleDisabled={!bundle.active && isOverLimit}
                        />
                        {i < complementBundles.length - 1 && <Divider />}
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}

            {/* Tiered bundles */}
            {tieredBundles.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingSm" as="h2">
                        Tiered combos
                      </Text>
                      <Badge tone="info">{String(tieredBundles.length)}</Badge>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/tiers/new")}
                      disabled={isOverLimit}
                      size="slim"
                    >
                      Add
                    </Button>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="0">
                    {tieredBundles.map((bundle, i) => (
                      <div key={`tiered-${bundle.id}`}>
                        <BundleRow
                          name={bundle.name}
                          active={bundle.active}
                          badge="Tiered"
                          badgeTone="info"
                          condition={getTieredCondition(bundle)}
                          detail={getTieredDetail(bundle.tiersConfig)}
                          onEdit={() => navigate(`/app/tiers/${bundle.id}`)}
                          onToggle={() => handleToggle(bundle.id, "tiered")}
                          onDelete={() => handleDelete(bundle.id, "tiered")}
                          toggleDisabled={!bundle.active && isOverLimit}
                        />
                        {i < tieredBundles.length - 1 && <Divider />}
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}

            {/* Volume bundles */}
            {volumeBundles.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingSm" as="h2">
                        Volume discounts
                      </Text>
                      <Badge tone="warning">{String(volumeBundles.length)}</Badge>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/volume/new")}
                      disabled={isOverLimit}
                      size="slim"
                    >
                      Add
                    </Button>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="0">
                    {volumeBundles.map((bundle, i) => (
                      <div key={`volume-${bundle.id}`}>
                        <BundleRow
                          name={bundle.name}
                          active={bundle.active}
                          badge="Volume"
                          badgeTone="warning"
                          condition={getVolumeCondition(bundle)}
                          detail={getVolumeDetail(bundle.volumeTiers)}
                          onEdit={() => navigate(`/app/volume/${bundle.id}`)}
                          onToggle={() => handleToggle(bundle.id, "volume")}
                          onDelete={() => handleDelete(bundle.id, "volume")}
                          toggleDisabled={!bundle.active && isOverLimit}
                        />
                        {i < volumeBundles.length - 1 && <Divider />}
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
