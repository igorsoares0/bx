import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Thumbnail,
  Select,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  setTieredBundleMetafield,
  removeTieredBundleMetafield,
} from "../lib/bundle-metafields.server";

const DEFAULT_TIERS = [
  { buyQty: 1, freeQty: 1, discountPct: 100 },
  { buyQty: 2, freeQty: 3, discountPct: 100 },
  { buyQty: 3, freeQty: 6, discountPct: 100 },
];

const DEFAULT_DESIGN = {
  accentColor: "#8cb600",
  backgroundColor: "#fafff0",
  textColor: "#1a1a1a",
  buttonColor: "#8cb600",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  headerText: "BUILD YOUR COMBO & SAVE",
  giftText: "+ FREE special gift!",
  cardLayout: "vertical",
};

type TierConfig = { buyQty: number; freeQty: number; discountPct: number };

function parseTiersConfig(raw: string | null | undefined): TierConfig[] {
  if (!raw) return DEFAULT_TIERS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_TIERS;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch the function ID for our bxgy-discount extension
  const fnResponse = await admin.graphql(
    `#graphql
      query {
        shopifyFunctions(first: 25) {
          nodes {
            apiType
            title
            id
          }
        }
      }`,
  );
  const fnJson = await fnResponse.json();
  const functions = fnJson.data?.shopifyFunctions?.nodes || [];
  const discountFunction = functions.find(
    (fn: any) =>
      fn.apiType === "product_discounts" &&
      fn.title === "bxgy-discount",
  );
  const functionId = discountFunction?.id || "";

  if (params.id === "new") {
    return json({
      bundle: null,
      tiers: DEFAULT_TIERS,
      functionId,
      productTitle: "",
      productImage: "",
      productPrice: 0,
    });
  }

  const bundle = await db.tieredBundle.findUnique({
    where: { id: Number(params.id) },
  });

  if (!bundle) {
    throw new Response("Tiered bundle not found", { status: 404 });
  }

  const tiers = parseTiersConfig(bundle.tiersConfig);

  let productTitle = bundle.productId;
  let productImage = "";
  let productPrice = 0;

  try {
    const res = await admin.graphql(
      `#graphql
        query getProduct($id: ID!) {
          product(id: $id) {
            title
            featuredImage { url }
            variants(first: 1) {
              edges { node { price } }
            }
          }
        }`,
      { variables: { id: bundle.productId } },
    );
    const prodJson = await res.json();
    productTitle = prodJson.data?.product?.title || bundle.productId;
    productImage = prodJson.data?.product?.featuredImage?.url || "";
    productPrice = prodJson.data?.product?.variants?.edges?.[0]?.node?.price
      ? Math.round(parseFloat(prodJson.data.product.variants.edges[0].node.price) * 100)
      : 0;
  } catch {
    // Keep GID as fallback
  }

  return json({ bundle, tiers, functionId, productTitle, productImage, productPrice });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const productId = formData.get("productId") as string;
  const tiersConfigRaw = formData.get("tiersConfig") as string;
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  const tiers: TierConfig[] = JSON.parse(tiersConfigRaw);

  // Function configuration with per-tier discount support
  const functionConfig = {
    buyType: "product",
    buyProductId: productId,
    buyCollectionIds: null,
    minQuantity: tiers[0]?.buyQty || 1,
    getProductId: productId, // same product
    discountType: "percentage",
    discountValue: tiers[0]?.discountPct || 100, // fallback for non-tiered logic
    maxReward: Math.max(...tiers.map((t) => t.freeQty)),
    tiers: tiers.map((t) => ({
      minQuantity: t.buyQty,
      maxReward: t.freeQty,
      discountValue: t.discountPct,
    })),
  };

  const isNew = params.id === "new";

  if (isNew) {
    const bundle = await db.tieredBundle.create({
      data: {
        name,
        productId,
        tiersConfig: tiersConfigRaw,
        shopId: session.shop,
        designConfig: designConfigRaw || null,
      },
    });

    // Create automatic discount in Shopify
    const discountResponse = await admin.graphql(
      `#graphql
        mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
            automaticAppDiscount {
              discountId
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          automaticAppDiscount: {
            title: name,
            functionId: formData.get("functionId") as string,
            startsAt: new Date().toISOString(),
            metafields: [
              {
                namespace: "$app:bxgy-discount",
                key: "function-configuration",
                type: "json",
                value: JSON.stringify(functionConfig),
              },
            ],
          },
        },
      },
    );

    const discountJson = await discountResponse.json();
    const result = discountJson.data?.discountAutomaticAppCreate;

    if (result?.userErrors?.length > 0) {
      return json(
        { errors: result.userErrors.map((e: any) => e.message) },
        { status: 400 },
      );
    }

    const discountId = result?.automaticAppDiscount?.discountId;

    if (discountId) {
      await db.tieredBundle.update({
        where: { id: bundle.id },
        data: { discountId },
      });
    }

    await setTieredBundleMetafield(admin, {
      productId,
      bundleName: name,
      tiers,
      designConfig,
    });
  } else {
    const bundleId = Number(params.id);
    const existing = await db.tieredBundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (!existing) {
      throw new Response("Tiered bundle not found", { status: 404 });
    }

    await db.tieredBundle.update({
      where: { id: bundleId },
      data: {
        name,
        productId,
        tiersConfig: tiersConfigRaw,
        designConfig: designConfigRaw || null,
      },
    });

    // Update metafield on product
    if (existing.productId !== productId) {
      await removeTieredBundleMetafield(admin, existing.productId);
    }

    await setTieredBundleMetafield(admin, {
      productId,
      bundleName: name,
      tiers,
      designConfig,
    });

    // Update the Shopify discount
    if (existing.discountId) {
      // Update title
      await admin.graphql(
        `#graphql
          mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
            discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            id: existing.discountId,
            automaticAppDiscount: {
              title: name,
            },
          },
        },
      );

      // Update function configuration metafield via metafieldsSet
      await admin.graphql(
        `#graphql
          mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            metafields: [
              {
                ownerId: existing.discountId,
                namespace: "$app:bxgy-discount",
                key: "function-configuration",
                type: "json",
                value: JSON.stringify(functionConfig),
              },
            ],
          },
        },
      );
    }
  }

  return redirect("/app");
};

export default function TieredBundleForm() {
  const { bundle, tiers: loadedTiers, functionId, productTitle, productImage, productPrice } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";
  const isNew = !bundle;

  const savedDesign = bundle?.designConfig
    ? { ...DEFAULT_DESIGN, ...JSON.parse(bundle.designConfig) }
    : DEFAULT_DESIGN;

  const [name, setName] = useState(bundle?.name || "");
  const [productId, setProductId] = useState(bundle?.productId || "");
  const [productLabel, setProductLabel] = useState(
    productTitle || bundle?.productId || "",
  );
  const [prodImage, setProdImage] = useState(productImage || "");
  const [prodPriceCents, setProdPriceCents] = useState(productPrice || 0);

  const [tiers, setTiers] = useState<TierConfig[]>(loadedTiers);

  const updateTier = (index: number, field: keyof TierConfig, value: string) => {
    setTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: Number(value) || 0 } : t)),
    );
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    setTiers((prev) => [
      ...prev,
      {
        buyQty: (last?.buyQty || 0) + 1,
        freeQty: (last?.freeQty || 0) + 1,
        discountPct: 100,
      },
    ]);
  };

  const removeTier = (index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  };

  const [design, setDesign] = useState(savedDesign);
  const updateDesign = (key: string, value: string | number) => {
    setDesign((prev: any) => ({ ...prev, [key]: value }));
  };

  const [errors, setErrors] = useState<string[]>([]);
  const [selectedPreviewTier, setSelectedPreviewTier] = useState(
    Math.min(1, tiers.length - 1),
  );

  const formatPreviewPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const handleSelectProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });

    if (selected) {
      const item = selected as any;
      const items = Array.isArray(item) ? item : [item];
      if (items.length > 0) {
        setProductId(items[0].id);
        setProductLabel(items[0].title || items[0].id);
        setProdImage(items[0].images?.[0]?.originalSrc || "");
        const firstVariant = items[0].variants?.[0];
        if (firstVariant?.price) {
          setProdPriceCents(Math.round(parseFloat(firstVariant.price) * 100));
        }
      }
    }
  }, [shopify]);

  const handleSubmit = () => {
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Name is required");
    if (!productId) validationErrors.push("Product is required");
    if (tiers.length === 0) validationErrors.push("At least one tier is required");

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("productId", productId);
    formData.set("functionId", functionId);
    formData.set("tiersConfig", JSON.stringify(tiers));
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  /* -- Preview data -- */
  const unitPrice = prodPriceCents || 19900;

  return (
    <Page
      title={isNew ? "Create tiered combo" : "Edit tiered combo"}
      backAction={{ url: "/app" }}
    >
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BlockStack gap="400">
            {errors.length > 0 && (
              <Banner tone="critical">
                <ul>
                  {errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Combo details
                </Text>
                <FormLayout>
                  <TextField
                    label="Combo name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    placeholder="e.g. Buy more save more"
                  />
                  <InlineStack gap="300" blockAlign="center">
                    {prodImage && (
                      <Thumbnail
                        source={prodImage}
                        alt={productLabel}
                        size="medium"
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Product"
                        value={productLabel}
                        readOnly
                        autoComplete="off"
                        placeholder="Select a product..."
                      />
                    </div>
                    <Button onClick={handleSelectProduct}>Browse</Button>
                  </InlineStack>
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Tiers
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Add as many tiers as you need. Customers buy X and get Y free of the same product.
                </Text>
                <FormLayout>
                  {tiers.map((tier, i) => (
                    <div key={i}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">Tier {i + 1}</Text>
                        {tiers.length > 1 && (
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => removeTier(i)}
                          >
                            Remove
                          </Button>
                        )}
                      </InlineStack>
                      <FormLayout.Group>
                        <TextField
                          label="Buy quantity"
                          type="number"
                          value={String(tier.buyQty)}
                          onChange={(v) => updateTier(i, "buyQty", v)}
                          autoComplete="off"
                          min={1}
                        />
                        <TextField
                          label="Free quantity"
                          type="number"
                          value={String(tier.freeQty)}
                          onChange={(v) => updateTier(i, "freeQty", v)}
                          autoComplete="off"
                          min={1}
                        />
                        <TextField
                          label="Discount %"
                          type="number"
                          value={String(tier.discountPct)}
                          onChange={(v) => updateTier(i, "discountPct", v)}
                          autoComplete="off"
                          suffix="%"
                          min={1}
                          max={100}
                        />
                      </FormLayout.Group>
                    </div>
                  ))}
                </FormLayout>
                <InlineStack align="start">
                  <Button onClick={addTier}>Add tier</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* -- Design Section -- */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Design
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <div>
                      <Text as="p" variant="bodySm">Accent color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.accentColor}
                          onChange={(e) => updateDesign("accentColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.accentColor} onChange={(v) => updateDesign("accentColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">Background color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.backgroundColor}
                          onChange={(e) => updateDesign("backgroundColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.backgroundColor} onChange={(v) => updateDesign("backgroundColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <div>
                      <Text as="p" variant="bodySm">Text color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.textColor}
                          onChange={(e) => updateDesign("textColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.textColor} onChange={(v) => updateDesign("textColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">Button color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.buttonColor}
                          onChange={(e) => updateDesign("buttonColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.buttonColor} onChange={(v) => updateDesign("buttonColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <div>
                      <Text as="p" variant="bodySm">Button text color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.buttonTextColor}
                          onChange={(e) => updateDesign("buttonTextColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.buttonTextColor} onChange={(v) => updateDesign("buttonTextColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                    <TextField
                      label="Border radius"
                      type="number"
                      value={String(design.borderRadius)}
                      onChange={(v) => updateDesign("borderRadius", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={0}
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Header text"
                    value={design.headerText}
                    onChange={(v) => updateDesign("headerText", v)}
                    autoComplete="off"
                    placeholder="e.g. BUILD YOUR COMBO & SAVE"
                  />
                  <TextField
                    label="Gift text"
                    value={design.giftText}
                    onChange={(v) => updateDesign("giftText", v)}
                    autoComplete="off"
                    placeholder="e.g. + FREE special gift!"
                    helpText="Leave empty to hide"
                  />
                  <Select
                    label="Card layout"
                    options={[
                      { label: "Vertical (stacked)", value: "vertical" },
                      { label: "Horizontal (side by side)", value: "horizontal" },
                    ]}
                    value={design.cardLayout || "vertical"}
                    onChange={(v) => updateDesign("cardLayout", v)}
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={isSubmitting}
              >
                {isNew ? "Create combo" : "Save changes"}
              </Button>
            </InlineStack>
          </BlockStack>
        </div>

        {/* -- Tiers Preview -- */}
        <div style={{ width: 340, flexShrink: 0, position: "sticky", top: 20, alignSelf: "flex-start" }}>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme preview
              </Text>

              <div style={{ background: design.backgroundColor, borderRadius: `${design.borderRadius}px`, padding: "16px", border: "1px solid #e5e5e5" }}>
                {/* Header */}
                <div style={{ borderBottom: `2px solid ${design.textColor}`, paddingBottom: "8px", marginBottom: "12px" }}>
                  <div style={{ fontWeight: 800, fontSize: "13px", color: design.textColor, textTransform: "uppercase" as const, letterSpacing: "0.5px", textAlign: "center" }}>
                    {design.headerText}
                  </div>
                </div>

                {/* Tiers */}
                <div style={{ display: "flex", flexDirection: design.cardLayout === "horizontal" ? "row" : "column", gap: "8px", marginBottom: "12px" }}>
                  {tiers.map((tier, i) => {
                    const isSelected = selectedPreviewTier === i;
                    const totalQty = tier.buyQty + tier.freeQty;
                    const originalCents = totalQty * unitPrice;
                    const freeDiscountCents = Math.round(tier.freeQty * unitPrice * tier.discountPct / 100);
                    const finalCents = originalCents - freeDiscountCents;
                    const savePct = totalQty > 0 ? Math.round((freeDiscountCents / originalCents) * 100) : 0;
                    const isHorizontal = design.cardLayout === "horizontal";
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedPreviewTier(i)}
                        style={{
                          display: "flex",
                          flexDirection: isHorizontal ? "column" : "row",
                          alignItems: "center",
                          gap: isHorizontal ? "6px" : "10px",
                          padding: isHorizontal ? "14px 10px" : "12px 14px",
                          borderRadius: isHorizontal ? "12px" : "28px",
                          border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #e5e5e5",
                          background: isSelected ? `${design.accentColor}08` : "#fff",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          flex: isHorizontal ? 1 : undefined,
                          textAlign: isHorizontal ? "center" : undefined,
                          minWidth: 0,
                        }}
                      >
                        {!isHorizontal && (
                          <div style={{ width: 20, height: 20, borderRadius: "50%", border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isSelected && <div style={{ width: 10, height: 10, borderRadius: "50%", background: design.accentColor }} />}
                          </div>
                        )}
                        <div style={{ flex: isHorizontal ? undefined : 1 }}>
                          <div style={{ fontWeight: 600, fontSize: "12px", color: design.textColor }}>
                            Buy {tier.buyQty}, get {tier.freeQty} {tier.discountPct >= 100 ? "free" : `${tier.discountPct}% off`}
                          </div>
                          <div style={{ marginTop: "4px" }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, color: design.accentColor, background: `${design.accentColor}18`, padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" as const }}>
                              SAVE {savePct}%
                            </span>
                          </div>
                        </div>
                        <div style={{ textAlign: isHorizontal ? "center" : "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: isHorizontal ? "13px" : "14px", color: isSelected ? design.accentColor : design.textColor }}>
                            {formatPreviewPrice(finalCents)}
                          </div>
                          <div style={{ fontSize: "10px", textDecoration: "line-through", color: "#999" }}>
                            {formatPreviewPrice(originalCents)}
                          </div>
                        </div>
                        {isHorizontal && (
                          <div style={{ width: 16, height: 16, borderRadius: "50%", border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: design.accentColor }} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Gift footer */}
                {design.giftText && (
                  <div style={{ background: `${design.accentColor}12`, borderRadius: "8px", padding: "10px 14px", textAlign: "center", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, fontSize: "13px", color: design.textColor }}>
                      {design.giftText}
                    </span>
                  </div>
                )}

                {/* Button */}
                <div style={{ width: "100%", padding: "12px 16px", fontSize: "14px", fontWeight: 700, border: "none", borderRadius: "8px", background: design.buttonColor, color: design.buttonTextColor, textAlign: "center", cursor: "default" }}>
                  Add Bundle to Cart
                </div>
                <div style={{ textAlign: "center", fontSize: "10px", color: "#888", marginTop: "8px" }}>
                  Discount applied automatically at checkout
                </div>
              </div>

              <Text as="p" variant="bodySm" tone="subdued">
                Prices based on first variant. Updates live on storefront.
              </Text>
            </BlockStack>
          </Card>
        </div>
      </div>
    </Page>
  );
}
