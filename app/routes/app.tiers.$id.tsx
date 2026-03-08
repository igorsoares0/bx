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
  Checkbox,
  Select,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  setTieredBundleMetafield,
  removeTieredBundleMetafield,
  setShopTieredBundleMetafield,
} from "../lib/bundle-metafields.server";

const DEFAULT_TIERS = [
  { buyQty: 1, freeQty: 1, discountPct: 100 },
  { buyQty: 2, freeQty: 3, discountPct: 100 },
  { buyQty: 3, freeQty: 6, discountPct: 100 },
];

const DEFAULT_DESIGN = {
  accentColor: "#2563eb",
  backgroundColor: "#f0f6ff",
  textColor: "#1a1a1a",
  buttonColor: "#2563eb",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  headerText: "BUILD YOUR COMBO & SAVE",
  giftText: "",
  cardLayout: "vertical",
  showVariants: true,
  // Typography
  headerFontSize: 18,
  headerAlignment: "center",
  buttonText: "Add Bundle to Cart",
  // Layout & Spacing
  tierStyle: "card",
  padding: 20,
  showBadge: true,
  badgeStyle: "square",
  // Image & Product
  showProductImage: false,
  imageSize: 64,
  // Visual Effects
  borderStyle: "solid",
  borderColor: "#e5e5e5",
  selectedTierBg: "",
  buttonBorderRadius: 8,
  shadowIntensity: "none",
  // Native button
  useNativeButton: false,
  // Button action
  buttonAction: "cart",
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
  const { admin, session } = await authenticate.admin(request);

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
      products: [] as Array<{ id: string; title: string; image: string; price: number }>,
      triggerTitle: "",
      triggerImage: "",
    });
  }

  const bundleId = Number(params.id);
  if (!Number.isInteger(bundleId)) {
    throw new Response("Tiered bundle not found", { status: 404 });
  }

  const bundle = await db.tieredBundle.findFirst({
    where: { id: bundleId, shopId: session.shop },
  });

  if (!bundle) {
    throw new Response("Tiered bundle not found", { status: 404 });
  }

  const tiers = parseTiersConfig(bundle.tiersConfig);

  // Parse productIds (supports legacy single GID and JSON array)
  let productIds: string[] = [];
  if (bundle.productId) {
    try {
      const parsed = JSON.parse(bundle.productId);
      productIds = Array.isArray(parsed) ? parsed : [bundle.productId];
    } catch {
      productIds = [bundle.productId];
    }
  }

  // Fetch product info for each selected product
  const products: Array<{ id: string; title: string; image: string; price: number }> = [];
  for (const pid of productIds) {
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
        { variables: { id: pid } },
      );
      const prodJson = await res.json();
      products.push({
        id: pid,
        title: prodJson.data?.product?.title || pid,
        image: prodJson.data?.product?.featuredImage?.url || "",
        price: prodJson.data?.product?.variants?.edges?.[0]?.node?.price
          ? Math.round(parseFloat(prodJson.data.product.variants.edges[0].node.price) * 100)
          : 0,
      });
    } catch {
      products.push({ id: pid, title: pid, image: "", price: 0 });
    }
  }

  // Fetch trigger info for collection type
  let triggerTitle = "";
  let triggerImage = "";
  if (bundle.triggerType === "collection" && bundle.triggerReference) {
    try {
      const res = await admin.graphql(
        `#graphql
          query getCollection($id: ID!) {
            collection(id: $id) {
              title
              image { url }
            }
          }`,
        { variables: { id: bundle.triggerReference } },
      );
      const colJson = await res.json();
      triggerTitle = colJson.data?.collection?.title || bundle.triggerReference;
      triggerImage = colJson.data?.collection?.image?.url || "";
    } catch {}
  }

  return json({ bundle, tiers, functionId, products, triggerTitle, triggerImage });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Revenue limit enforcement — block creation of new bundles if over plan limit
  if (params.id === "new") {
    const { getShopBillingStatus } = await import("../lib/billing.server");
    const status = await getShopBillingStatus(admin, session.shop);
    if (status.isOverLimit) {
      return json(
        { errors: { form: "You have exceeded your plan's revenue limit. Please upgrade your plan to create new bundles." } },
        { status: 403 },
      );
    }
  }

  const name = formData.get("name") as string;
  const triggerType = (formData.get("triggerType") as string) || "product";
  const triggerReference = (formData.get("triggerReference") as string) || null;
  const productIdsRaw = formData.get("productIds") as string;
  const tiersConfigRaw = formData.get("tiersConfig") as string;
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  const tiers: TierConfig[] = JSON.parse(tiersConfigRaw);
  const productIds: string[] = productIdsRaw ? JSON.parse(productIdsRaw) : [];

  // For collection trigger, resolve product IDs from collection for function config
  let resolvedProductIds = productIds;
  if (triggerType === "collection" && triggerReference) {
    try {
      const colRes = await admin.graphql(
        `#graphql
          query getCollectionProducts($id: ID!) {
            collection(id: $id) {
              products(first: 250) {
                edges { node { id } }
              }
            }
          }`,
        { variables: { id: triggerReference } },
      );
      const colJson = await colRes.json();
      resolvedProductIds = colJson.data?.collection?.products?.edges?.map(
        (e: any) => e.node.id,
      ) || [];
    } catch {}
  }

  // Function configuration
  const functionConfig: Record<string, unknown> = {
    title: name,
    bundleType: "tiered",
    buyType: triggerType,
    buyProductId: productIds[0] || null,
    buyProductIds: triggerType === "product" ? productIds : resolvedProductIds,
    buyCollectionIds: triggerType === "collection" && triggerReference ? [triggerReference] : null,
    minQuantity: tiers[0]?.buyQty || 1,
    getProductId: productIds[0] || "gid://shopify/Product/0",
    getProductIds: triggerType === "product" ? productIds : resolvedProductIds,
    discountType: "percentage",
    discountValue: tiers[0]?.discountPct || 100,
    maxReward: Math.max(...tiers.map((t) => t.freeQty)),
    tiers: tiers.map((t) => ({
      minQuantity: t.buyQty,
      maxReward: t.freeQty,
      discountValue: t.discountPct,
    })),
  };

  // Store productId as JSON array for multi-product
  const productIdStored = JSON.stringify(productIds);

  const isNew = params.id === "new";
  const editBundleId = isNew ? undefined : Number(params.id);

  // ── Conflict validation: prevent duplicate triggers ──
  if (triggerType === "product") {
    for (const pid of productIds) {
      const conflicting = await db.tieredBundle.findFirst({
        where: {
          shopId: session.shop,
          active: true,
          triggerType: "product",
          productId: { contains: pid },
          ...(editBundleId ? { id: { not: editBundleId } } : {}),
        },
      });
      if (conflicting) {
        return json(
          { errors: [`Product already has an active tiered bundle: "${conflicting.name}"`] },
          { status: 400 },
        );
      }
    }
  } else if (triggerType === "all") {
    const conflicting = await db.tieredBundle.findFirst({
      where: {
        shopId: session.shop,
        active: true,
        triggerType: "all",
        ...(editBundleId ? { id: { not: editBundleId } } : {}),
      },
    });
    if (conflicting) {
      return json(
        { errors: [`An "all products" tiered bundle already exists: "${conflicting.name}"`] },
        { status: 400 },
      );
    }
  }

  if (isNew) {
    const bundle = await db.tieredBundle.create({
      data: {
        name,
        triggerType,
        triggerReference,
        productId: productIdStored,
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
    } else {
      await db.tieredBundle.delete({ where: { id: bundle.id } });
      return json({ errors: ["Failed to create Shopify discount"] }, { status: 500 });
    }

    if (!discountId) {
      await db.tieredBundle.delete({ where: { id: bundle.id } });
      return json({ errors: ["Failed to create Shopify discount"] }, { status: 500 });
    }

    // Set metafields on products (product trigger only)
    if (triggerType === "product" && productIds.length > 0) {
      await setTieredBundleMetafield(admin, {
        bundleId: bundle.id,
        productIds,
        bundleName: name,
        tiers,
        designConfig,
      });
    }

    // Sync shop-level metafield for collection/all triggers
    await setShopTieredBundleMetafield(admin, session.shop, db);
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
        triggerType,
        triggerReference,
        productId: productIdStored,
        tiersConfig: tiersConfigRaw,
        designConfig: designConfigRaw || null,
      },
    });

    // Clean old metafields from previous products
    let oldProductIds: string[] = [];
    if (existing.productId) {
      try {
        const parsed = JSON.parse(existing.productId);
        oldProductIds = Array.isArray(parsed) ? parsed : [existing.productId];
      } catch {
        oldProductIds = [existing.productId];
      }
    }
    const removedProducts = oldProductIds.filter((id) => !productIds.includes(id));
    if (removedProducts.length > 0) {
      await removeTieredBundleMetafield(admin, removedProducts, bundleId);
    }

    // Set metafields on products (product trigger only)
    if (triggerType === "product" && productIds.length > 0) {
      await setTieredBundleMetafield(admin, {
        bundleId,
        productIds,
        bundleName: name,
        tiers,
        designConfig,
      });
    } else if (existing.triggerType === "product" || !existing.triggerType) {
      // Switched away from product type - remove old product metafields
      if (oldProductIds.length > 0) {
        await removeTieredBundleMetafield(admin, oldProductIds, bundleId);
      }
    }

    // Sync shop-level metafield for collection/all triggers
    await setShopTieredBundleMetafield(admin, session.shop, db);

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
  const { bundle, tiers: loadedTiers, functionId, products: loadedProducts, triggerTitle: loadedTriggerTitle, triggerImage: loadedTriggerImage } =
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
  const [triggerType, setTriggerType] = useState(bundle?.triggerType || "product");
  const [triggerReference, setTriggerReference] = useState(bundle?.triggerReference || "");
  const [triggerLabel, setTriggerLabel] = useState(loadedTriggerTitle || "");
  const [triggerImg, setTriggerImg] = useState(loadedTriggerImage || "");
  const [products, setProducts] = useState<Array<{ id: string; title: string; image: string; price: number }>>(loadedProducts);

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
  const updateDesign = (key: string, value: string | number | boolean) => {
    setDesign((prev: any) => ({ ...prev, [key]: value }));
  };

  const [errors, setErrors] = useState<string[]>([]);
  const [selectedPreviewTier, setSelectedPreviewTier] = useState(
    Math.min(1, tiers.length - 1),
  );

  const formatPreviewPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const handleSelectProducts = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: products.map((p) => ({ id: p.id })),
    });

    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      setProducts(
        items.map((item: any) => ({
          id: item.id,
          title: item.title || item.id,
          image: item.images?.[0]?.originalSrc || "",
          price: item.variants?.[0]?.price
            ? Math.round(parseFloat(item.variants[0].price) * 100)
            : 0,
        })),
      );
    }
  }, [shopify, products]);

  const removeProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSelectCollection = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: false,
    });
    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      if (items.length > 0) {
        setTriggerReference(items[0].id);
        setTriggerLabel(items[0].title || items[0].id);
        setTriggerImg((items[0] as any).image?.originalSrc || "");
      }
    }
  }, [shopify]);

  const handleSubmit = () => {
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Name is required");
    if (triggerType === "product" && products.length === 0) {
      validationErrors.push("At least one product is required");
    }
    if (triggerType === "collection" && !triggerReference) {
      validationErrors.push("Collection is required");
    }
    if (tiers.length === 0) validationErrors.push("At least one tier is required");

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("triggerType", triggerType);
    formData.set("triggerReference", triggerReference);
    formData.set("productIds", JSON.stringify(products.map((p) => p.id)));
    formData.set("functionId", functionId);
    formData.set("tiersConfig", JSON.stringify(tiers));
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  /* -- Preview data -- */
  const unitPrice = products[0]?.price || 19900;

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
                  <Select
                    label="Applies to"
                    options={[
                      { label: "Specific products", value: "product" },
                      { label: "Collection", value: "collection" },
                      { label: "All products", value: "all" },
                    ]}
                    value={triggerType}
                    onChange={(v) => {
                      setTriggerType(v);
                      if (v !== "product") setProducts([]);
                      if (v !== "collection") {
                        setTriggerReference("");
                        setTriggerLabel("");
                        setTriggerImg("");
                      }
                    }}
                  />
                  {triggerType === "product" && (
                    <BlockStack gap="200">
                      {products.map((prod) => (
                        <InlineStack key={prod.id} gap="300" blockAlign="center">
                          {prod.image ? (
                            <Thumbnail source={prod.image} alt={prod.title} size="small" />
                          ) : (
                            <div style={{ width: 40, height: 40, background: "#f0f0f0", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#999" }}>N/A</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{prod.title}</Text>
                          </div>
                          <Button variant="plain" tone="critical" onClick={() => removeProduct(prod.id)}>
                            Remove
                          </Button>
                        </InlineStack>
                      ))}
                      <Button onClick={handleSelectProducts}>
                        {products.length > 0 ? "Add / change products" : "Browse products"}
                      </Button>
                    </BlockStack>
                  )}
                  {triggerType === "collection" && (
                    <InlineStack gap="300" blockAlign="center">
                      {triggerImg && (
                        <Thumbnail source={triggerImg} alt={triggerLabel} size="medium" />
                      )}
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Collection"
                          value={triggerLabel}
                          readOnly
                          autoComplete="off"
                          placeholder="Select a collection..."
                        />
                      </div>
                      <Button onClick={handleSelectCollection}>Browse</Button>
                    </InlineStack>
                  )}
                  {triggerType === "all" && (
                    <Banner tone="info">
                      <p>This combo will appear on all product pages in your store.</p>
                    </Banner>
                  )}
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
                  <Select
                    label="Card layout"
                    options={[
                      { label: "Vertical (stacked)", value: "vertical" },
                      { label: "Horizontal (side by side)", value: "horizontal" },
                    ]}
                    value={design.cardLayout || "vertical"}
                    onChange={(v) => updateDesign("cardLayout", v)}
                  />
                  <Checkbox
                    label="Show variant selectors (color, size, etc.)"
                    helpText="When enabled, customers can pick different variants for each item in the bundle"
                    checked={design.showVariants !== false}
                    onChange={(v) => updateDesign("showVariants", v)}
                  />
                </FormLayout>

                {/* Typography */}
                <Text as="h3" variant="headingSm">Typography</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Header font size"
                      type="number"
                      value={String(design.headerFontSize)}
                      onChange={(v) => updateDesign("headerFontSize", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={14}
                      max={32}
                    />
                    <Select
                      label="Header alignment"
                      options={[
                        { label: "Left", value: "left" },
                        { label: "Center", value: "center" },
                        { label: "Right", value: "right" },
                      ]}
                      value={design.headerAlignment}
                      onChange={(v) => updateDesign("headerAlignment", v)}
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Button text"
                    value={design.buttonText}
                    onChange={(v) => updateDesign("buttonText", v)}
                    autoComplete="off"
                    placeholder="e.g. Add Bundle to Cart"
                    disabled={design.useNativeButton}
                  />
                  <Checkbox
                    label="Use theme's native Add to Cart button"
                    helpText="Hides the bundle button. The theme's native buttons (Add to Cart, Buy it Now) will automatically use the selected bundle quantity."
                    checked={design.useNativeButton === true}
                    onChange={(v) => updateDesign("useNativeButton", v)}
                  />
                  {!design.useNativeButton && (
                    <Select
                      label="Button action"
                      options={[
                        { label: "Add to cart", value: "cart" },
                        { label: "Go to checkout", value: "checkout" },
                      ]}
                      value={design.buttonAction || "cart"}
                      onChange={(v) => updateDesign("buttonAction", v)}
                    />
                  )}
                </FormLayout>

                {/* Layout & Spacing */}
                <Text as="h3" variant="headingSm">Layout & Spacing</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Select
                      label="Tier style"
                      options={[
                        { label: "Card (white bg + border)", value: "card" },
                        { label: "Minimal (no bg/border)", value: "minimal" },
                        { label: "Bordered (transparent + border)", value: "bordered" },
                      ]}
                      value={design.tierStyle}
                      onChange={(v) => updateDesign("tierStyle", v)}
                    />
                    <TextField
                      label="Container padding"
                      type="number"
                      value={String(design.padding)}
                      onChange={(v) => updateDesign("padding", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={8}
                      max={32}
                    />
                  </FormLayout.Group>
                  <Checkbox
                    label="Show SAVE % badge"
                    checked={design.showBadge !== false}
                    onChange={(v) => updateDesign("showBadge", v)}
                  />
                  {design.showBadge !== false && (
                    <Select
                      label="Badge style"
                      options={[
                        { label: "Square (4px radius)", value: "square" },
                        { label: "Pill (rounded)", value: "pill" },
                        { label: "Ribbon (angled)", value: "ribbon" },
                      ]}
                      value={design.badgeStyle}
                      onChange={(v) => updateDesign("badgeStyle", v)}
                    />
                  )}
                </FormLayout>

                {/* Image & Product */}
                <Text as="h3" variant="headingSm">Image & Product</Text>
                <FormLayout>
                  <Checkbox
                    label="Show product image in tier rows"
                    checked={design.showProductImage !== false}
                    onChange={(v) => updateDesign("showProductImage", v)}
                  />
                  {design.showProductImage !== false && (
                    <TextField
                      label="Image size"
                      type="number"
                      value={String(design.imageSize)}
                      onChange={(v) => updateDesign("imageSize", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={40}
                      max={120}
                    />
                  )}
                </FormLayout>

                {/* Visual Effects */}
                <Text as="h3" variant="headingSm">Visual Effects</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <Select
                      label="Border style"
                      options={[
                        { label: "Solid", value: "solid" },
                        { label: "Dashed", value: "dashed" },
                        { label: "None", value: "none" },
                      ]}
                      value={design.borderStyle}
                      onChange={(v) => updateDesign("borderStyle", v)}
                    />
                    <div>
                      <Text as="p" variant="bodySm">Border color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.borderColor || "#e5e5e5"}
                          onChange={(e) => updateDesign("borderColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField label="" labelHidden value={design.borderColor} onChange={(v) => updateDesign("borderColor", v)} autoComplete="off" />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <div>
                    <Text as="p" variant="bodySm">Selected tier background</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <input
                        type="color"
                        value={design.selectedTierBg || "#ffffff"}
                        onChange={(e) => updateDesign("selectedTierBg", e.target.value)}
                        style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                      />
                      <TextField label="" labelHidden value={design.selectedTierBg} onChange={(v) => updateDesign("selectedTierBg", v)} autoComplete="off" helpText="Leave empty for auto (accent + opacity)" />
                    </InlineStack>
                  </div>
                  <FormLayout.Group>
                    <TextField
                      label="Button border radius"
                      type="number"
                      value={String(design.buttonBorderRadius)}
                      onChange={(v) => updateDesign("buttonBorderRadius", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={0}
                      max={50}
                    />
                    <Select
                      label="Shadow intensity"
                      options={[
                        { label: "None", value: "none" },
                        { label: "Light", value: "light" },
                        { label: "Medium", value: "medium" },
                      ]}
                      value={design.shadowIntensity}
                      onChange={(v) => updateDesign("shadowIntensity", v)}
                    />
                  </FormLayout.Group>
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
          <div style={{ background: "var(--p-color-bg-surface)", borderRadius: "var(--p-border-radius-300)", boxShadow: "var(--p-shadow-100)", padding: "var(--p-space-400)", overflow: "visible" }}>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme preview
              </Text>

              <div style={{
                background: design.backgroundColor,
                borderRadius: `${design.borderRadius}px`,
                padding: `${design.padding}px`,
                border: design.borderStyle === "none" ? "none" : `1px ${design.borderStyle} ${design.borderColor}`,
                boxShadow: design.shadowIntensity === "light" ? "0 1px 3px rgba(0,0,0,0.08)" : design.shadowIntensity === "medium" ? "0 4px 12px rgba(0,0,0,0.12)" : "none",
              }}>
                {/* Header */}
                <div style={{ borderBottom: `2px solid ${design.textColor}`, paddingBottom: "8px", marginBottom: "12px" }}>
                  <div style={{ fontWeight: 800, fontSize: `${design.headerFontSize}px`, color: design.textColor, textTransform: "uppercase" as const, letterSpacing: "0.5px", textAlign: design.headerAlignment as any }}>
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
                          flexDirection: "column",
                          padding: isHorizontal ? "14px 10px" : "12px 14px",
                          borderRadius: design.tierStyle === "minimal" ? 0 : isHorizontal ? "12px" : "28px",
                          border: "2px solid transparent",
                          boxShadow: design.tierStyle === "minimal"
                            ? "none"
                            : isSelected
                              ? `0 0 0 2px ${design.accentColor}`
                              : "0 0 0 2px #e5e5e5",
                          borderBottom: design.tierStyle === "minimal" ? "1px solid #e5e5e5" : undefined,
                          background: isSelected
                            ? (design.selectedTierBg || `${design.accentColor}08`)
                            : design.tierStyle === "card" ? "#fff" : "transparent",
                          cursor: "pointer",
                          flex: isHorizontal ? 1 : undefined,
                          textAlign: isHorizontal ? "center" : undefined,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: isHorizontal ? "column" : "row", alignItems: "center", gap: isHorizontal ? "6px" : "10px" }}>
                          {!isHorizontal && (
                            <div style={{ width: 20, height: 20, borderRadius: "50%", border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {isSelected && <div style={{ width: 10, height: 10, borderRadius: "50%", background: design.accentColor }} />}
                            </div>
                          )}
                          {design.showProductImage !== false && (
                            products[0]?.image ? (
                              <img src={products[0].image} alt={products[0].title || ""} style={{ width: `${Math.min(design.imageSize || 64, 40)}px`, height: `${Math.min(design.imageSize || 64, 40)}px`, borderRadius: "6px", objectFit: "cover", flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: `${Math.min(design.imageSize || 64, 40)}px`, height: `${Math.min(design.imageSize || 64, 40)}px`, borderRadius: "6px", background: "#e0e0e0", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: "#999" }}>IMG</div>
                            )
                          )}
                          <div style={{ flex: isHorizontal ? undefined : 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "12px", color: design.textColor }}>
                              Buy {tier.buyQty}, get {tier.freeQty} {tier.discountPct >= 100 ? "free" : `${tier.discountPct}% off`}
                            </div>
                            {design.showBadge !== false && (
                              <div style={{ marginTop: "4px" }}>
                                <span style={{
                                  fontSize: "9px",
                                  fontWeight: 700,
                                  color: design.accentColor,
                                  background: `${design.accentColor}18`,
                                  padding: "2px 6px",
                                  borderRadius: design.badgeStyle === "pill" ? "999px" : design.badgeStyle === "ribbon" ? "0 4px 4px 0" : "4px",
                                  textTransform: "uppercase" as const,
                                }}>
                                  SAVE {savePct}%
                                </span>
                              </div>
                            )}
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
                        {/* Variant selectors preview */}
                        {isSelected && design.showVariants !== false && totalQty > 1 && (
                          <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e5e5e5" }}>
                            <div style={{ fontSize: "10px", color: "#777", marginBottom: "6px" }}>Cor, Tamanho</div>
                            {Array.from({ length: Math.min(totalQty, 4) }).map((_, qi) => (
                              <div key={qi} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: "#888", minWidth: "18px" }}>#{qi + 1}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: "3px", background: "#fff", border: "1px solid #ddd", borderRadius: "5px", padding: "3px 5px" }}>
                                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#38a169", border: "1px solid #ccc" }} />
                                  <span style={{ fontSize: "11px", color: design.textColor }}>Verde ▾</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "3px", background: "#fff", border: "1px solid #ddd", borderRadius: "5px", padding: "3px 5px" }}>
                                  <span style={{ fontSize: "11px", color: design.textColor }}>M ▾</span>
                                </div>
                              </div>
                            ))}
                            {totalQty > 4 && (
                              <div style={{ fontSize: "9px", color: "#999", textAlign: "center" }}>+{totalQty - 4} more…</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>


                {/* Button */}
                {!design.useNativeButton && (
                <div style={{ width: "100%", padding: "12px 16px", fontSize: "14px", fontWeight: 700, border: "none", borderRadius: `${design.buttonBorderRadius}px`, background: design.buttonColor, color: design.buttonTextColor, textAlign: "center", cursor: "default" }}>
                  {design.buttonText}
                </div>
                )}
                <div style={{ textAlign: "center", fontSize: "10px", color: "#888", marginTop: "8px" }}>
                  Discount applied automatically at checkout
                </div>
              </div>

              <Text as="p" variant="bodySm" tone="subdued">
                Prices based on first variant. Updates live on storefront.
              </Text>
            </BlockStack>
          </div>
        </div>
      </div>
    </Page>
  );
}
