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
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  setTieredBundleMetafield,
  removeTieredBundleMetafield,
} from "../lib/bundle-metafields.server";

const DEFAULT_DESIGN = {
  accentColor: "#8cb600",
  backgroundColor: "#fafff0",
  textColor: "#1a1a1a",
  buttonColor: "#8cb600",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  headerText: "BUILD YOUR COMBO & SAVE",
  giftText: "+ FREE special gift!",
};

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

  return json({ bundle, functionId, productTitle, productImage, productPrice });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const productId = formData.get("productId") as string;
  const tier1BuyQty = Number(formData.get("tier1BuyQty"));
  const tier1FreeQty = Number(formData.get("tier1FreeQty"));
  const tier1DiscountPct = Number(formData.get("tier1DiscountPct"));
  const tier2BuyQty = Number(formData.get("tier2BuyQty"));
  const tier2FreeQty = Number(formData.get("tier2FreeQty"));
  const tier2DiscountPct = Number(formData.get("tier2DiscountPct"));
  const tier3BuyQty = Number(formData.get("tier3BuyQty"));
  const tier3FreeQty = Number(formData.get("tier3FreeQty"));
  const tier3DiscountPct = Number(formData.get("tier3DiscountPct"));
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  // Function configuration with per-tier discount support
  const functionConfig = {
    buyType: "product",
    buyProductId: productId,
    buyCollectionIds: null,
    minQuantity: tier1BuyQty,
    getProductId: productId, // same product
    discountType: "percentage",
    discountValue: tier1DiscountPct, // fallback for non-tiered logic
    maxReward: Math.max(tier1FreeQty, tier2FreeQty, tier3FreeQty),
    tiers: [
      { minQuantity: tier1BuyQty, maxReward: tier1FreeQty, discountValue: tier1DiscountPct },
      { minQuantity: tier2BuyQty, maxReward: tier2FreeQty, discountValue: tier2DiscountPct },
      { minQuantity: tier3BuyQty, maxReward: tier3FreeQty, discountValue: tier3DiscountPct },
    ],
  };

  const isNew = params.id === "new";

  if (isNew) {
    const bundle = await db.tieredBundle.create({
      data: {
        name,
        productId,
        tier1BuyQty,
        tier1FreeQty,
        tier1DiscountPct,
        tier2BuyQty,
        tier2FreeQty,
        tier2DiscountPct,
        tier3BuyQty,
        tier3FreeQty,
        tier3DiscountPct,
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
      tier1BuyQty,
      tier1FreeQty,
      tier1DiscountPct,
      tier2BuyQty,
      tier2FreeQty,
      tier2DiscountPct,
      tier3BuyQty,
      tier3FreeQty,
      tier3DiscountPct,
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
        tier1BuyQty,
        tier1FreeQty,
        tier1DiscountPct,
        tier2BuyQty,
        tier2FreeQty,
        tier2DiscountPct,
        tier3BuyQty,
        tier3FreeQty,
        tier3DiscountPct,
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
      tier1BuyQty,
      tier1FreeQty,
      tier1DiscountPct,
      tier2BuyQty,
      tier2FreeQty,
      tier2DiscountPct,
      tier3BuyQty,
      tier3FreeQty,
      tier3DiscountPct,
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
  const { bundle, functionId, productTitle, productImage, productPrice } =
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

  const [tier1BuyQty, setTier1BuyQty] = useState(String(bundle?.tier1BuyQty || 1));
  const [tier1FreeQty, setTier1FreeQty] = useState(String(bundle?.tier1FreeQty || 1));
  const [tier1DiscountPct, setTier1DiscountPct] = useState(String(bundle?.tier1DiscountPct ?? 100));
  const [tier2BuyQty, setTier2BuyQty] = useState(String(bundle?.tier2BuyQty || 2));
  const [tier2FreeQty, setTier2FreeQty] = useState(String(bundle?.tier2FreeQty || 3));
  const [tier2DiscountPct, setTier2DiscountPct] = useState(String(bundle?.tier2DiscountPct ?? 100));
  const [tier3BuyQty, setTier3BuyQty] = useState(String(bundle?.tier3BuyQty || 3));
  const [tier3FreeQty, setTier3FreeQty] = useState(String(bundle?.tier3FreeQty || 6));
  const [tier3DiscountPct, setTier3DiscountPct] = useState(String(bundle?.tier3DiscountPct ?? 100));

  const [design, setDesign] = useState(savedDesign);
  const updateDesign = (key: string, value: string | number) => {
    setDesign((prev: any) => ({ ...prev, [key]: value }));
  };

  const [errors, setErrors] = useState<string[]>([]);
  const [selectedPreviewTier, setSelectedPreviewTier] = useState(1);

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

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("productId", productId);
    formData.set("functionId", functionId);
    formData.set("tier1BuyQty", tier1BuyQty);
    formData.set("tier1FreeQty", tier1FreeQty);
    formData.set("tier1DiscountPct", tier1DiscountPct);
    formData.set("tier2BuyQty", tier2BuyQty);
    formData.set("tier2FreeQty", tier2FreeQty);
    formData.set("tier2DiscountPct", tier2DiscountPct);
    formData.set("tier3BuyQty", tier3BuyQty);
    formData.set("tier3FreeQty", tier3FreeQty);
    formData.set("tier3DiscountPct", tier3DiscountPct);
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  /* ── Preview data ── */
  const unitPrice = prodPriceCents || 19900;
  const tiers = [
    { buyQty: Number(tier1BuyQty), freeQty: Number(tier1FreeQty), discPct: Number(tier1DiscountPct) || 100 },
    { buyQty: Number(tier2BuyQty), freeQty: Number(tier2FreeQty), discPct: Number(tier2DiscountPct) || 100 },
    { buyQty: Number(tier3BuyQty), freeQty: Number(tier3FreeQty), discPct: Number(tier3DiscountPct) || 100 },
  ];

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
                  Configure up to 3 tiers. Customers buy X and get Y free of the same product.
                </Text>
                <FormLayout>
                  <Text as="h3" variant="headingSm">Tier 1</Text>
                  <FormLayout.Group>
                    <TextField label="Buy quantity" type="number" value={tier1BuyQty} onChange={setTier1BuyQty} autoComplete="off" min={1} />
                    <TextField label="Free quantity" type="number" value={tier1FreeQty} onChange={setTier1FreeQty} autoComplete="off" min={1} />
                    <TextField label="Discount %" type="number" value={tier1DiscountPct} onChange={setTier1DiscountPct} autoComplete="off" suffix="%" min={1} max={100} />
                  </FormLayout.Group>
                  <Text as="h3" variant="headingSm">Tier 2</Text>
                  <FormLayout.Group>
                    <TextField label="Buy quantity" type="number" value={tier2BuyQty} onChange={setTier2BuyQty} autoComplete="off" min={1} />
                    <TextField label="Free quantity" type="number" value={tier2FreeQty} onChange={setTier2FreeQty} autoComplete="off" min={1} />
                    <TextField label="Discount %" type="number" value={tier2DiscountPct} onChange={setTier2DiscountPct} autoComplete="off" suffix="%" min={1} max={100} />
                  </FormLayout.Group>
                  <Text as="h3" variant="headingSm">Tier 3</Text>
                  <FormLayout.Group>
                    <TextField label="Buy quantity" type="number" value={tier3BuyQty} onChange={setTier3BuyQty} autoComplete="off" min={1} />
                    <TextField label="Free quantity" type="number" value={tier3FreeQty} onChange={setTier3FreeQty} autoComplete="off" min={1} />
                    <TextField label="Discount %" type="number" value={tier3DiscountPct} onChange={setTier3DiscountPct} autoComplete="off" suffix="%" min={1} max={100} />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* ── Design Section ── */}
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

        {/* ── Tiers Preview ── */}
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
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  {tiers.map((tier, i) => {
                    const isSelected = selectedPreviewTier === i;
                    const totalQty = tier.buyQty + tier.freeQty;
                    const originalCents = totalQty * unitPrice;
                    const freeDiscountCents = Math.round(tier.freeQty * unitPrice * tier.discPct / 100);
                    const finalCents = originalCents - freeDiscountCents;
                    const savePct = totalQty > 0 ? Math.round((freeDiscountCents / originalCents) * 100) : 0;
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedPreviewTier(i)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "12px 14px",
                          borderRadius: "28px",
                          border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #e5e5e5",
                          background: isSelected ? `${design.accentColor}08` : "#fff",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ width: 20, height: 20, borderRadius: "50%", border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {isSelected && <div style={{ width: 10, height: 10, borderRadius: "50%", background: design.accentColor }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: "13px", color: design.textColor }}>
                            Buy {tier.buyQty}, get {tier.freeQty} {tier.discPct >= 100 ? "free" : `${tier.discPct}% off`}
                          </span>
                          <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 700, color: design.accentColor, background: `${design.accentColor}18`, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase" as const }}>
                            SAVE {savePct}%
                          </span>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "14px", color: isSelected ? design.accentColor : design.textColor }}>
                            {formatPreviewPrice(finalCents)}
                          </div>
                          <div style={{ fontSize: "11px", textDecoration: "line-through", color: "#999" }}>
                            {formatPreviewPrice(originalCents)}
                          </div>
                        </div>
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
