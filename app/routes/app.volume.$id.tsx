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
  setVolumeBundleMetafield,
  removeVolumeBundleMetafield,
  setShopVolumeBundleMetafield,
} from "../lib/bundle-metafields.server";

const DEFAULT_VOLUME_TIERS = [
  { label: "Single", qty: 1, discountPct: 0, popular: false },
  { label: "Duo", qty: 2, discountPct: 15, popular: true },
  { label: "Trio", qty: 3, discountPct: 25, popular: false },
];

const DEFAULT_DESIGN = {
  accentColor: "#8cb600",
  backgroundColor: "#fafff0",
  textColor: "#1a1a1a",
  buttonColor: "#8cb600",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  headerText: "BUY MORE & SAVE",
  badgeText: "Most Popular",
  cardLayout: "vertical",
};

type VolumeTier = { label: string; qty: number; discountPct: number; popular: boolean };

function parseVolumeTiers(raw: string | null | undefined): VolumeTier[] {
  if (!raw) return DEFAULT_VOLUME_TIERS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_VOLUME_TIERS;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
      volumeTiers: DEFAULT_VOLUME_TIERS,
      functionId,
      products: [] as Array<{ id: string; title: string; image: string; price: number }>,
      collectionTitle: "",
    });
  }

  const bundle = await db.volumeBundle.findUnique({
    where: { id: Number(params.id) },
  });

  if (!bundle) {
    throw new Response("Volume bundle not found", { status: 404 });
  }

  const volumeTiers = parseVolumeTiers(bundle.volumeTiers);

  // Parse productIds (backward compat: could be single GID or JSON array)
  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(bundle.productId);
    productIds = Array.isArray(parsed) ? parsed : [bundle.productId];
  } catch {
    productIds = bundle.productId ? [bundle.productId] : [];
  }

  // Fetch product info for each product
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

  // Fetch collection title if triggerType is collection
  let collectionTitle = "";
  if (bundle.triggerType === "collection" && bundle.triggerReference) {
    try {
      const colRes = await admin.graphql(
        `#graphql
          query getCollection($id: ID!) {
            collection(id: $id) { title }
          }`,
        { variables: { id: bundle.triggerReference } },
      );
      const colJson = await colRes.json();
      collectionTitle = colJson.data?.collection?.title || "";
    } catch {}
  }

  return json({ bundle, volumeTiers, functionId, products, collectionTitle });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const triggerType = (formData.get("triggerType") as string) || "product";
  const triggerReference = (formData.get("triggerReference") as string) || null;
  const productIdsRaw = formData.get("productIds") as string;
  const volumeTiersRaw = formData.get("volumeTiers") as string;
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  let productIds: string[] = [];
  try {
    productIds = JSON.parse(productIdsRaw);
  } catch {
    if (productIdsRaw) productIds = [productIdsRaw];
  }

  const volumeTiers: VolumeTier[] = JSON.parse(volumeTiersRaw);

  // For collection trigger, resolve collection products
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
      const colProducts = colJson.data?.collection?.products?.edges || [];
      resolvedProductIds = colProducts.map((e: any) => e.node.id);
    } catch {}
  }

  // Build function config — use buy_product_ids for volume path
  const functionConfig = {
    buyType: triggerType === "all" ? "all" : "product",
    buyProductId: resolvedProductIds[0] || "",
    buyProductIds: resolvedProductIds,
    buyCollectionIds: null,
    minQuantity: 1,
    getProductId: resolvedProductIds[0] || "",
    getProductIds: resolvedProductIds,
    discountType: "percentage",
    discountValue: 0,
    maxReward: 0,
    volumeTiers: volumeTiers.map((t) => ({
      qty: t.qty,
      discountPct: t.discountPct,
    })),
  };

  const productIdField = triggerType === "product" ? JSON.stringify(productIds) : JSON.stringify(resolvedProductIds);

  const isNew = params.id === "new";

  if (isNew) {
    const bundle = await db.volumeBundle.create({
      data: {
        name,
        triggerType,
        productId: productIdField,
        triggerReference,
        volumeTiers: volumeTiersRaw,
        shopId: session.shop,
        designConfig: designConfigRaw || null,
      },
    });

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
      await db.volumeBundle.update({
        where: { id: bundle.id },
        data: { discountId },
      });
    }

    // Set metafields
    if (triggerType === "product") {
      await setVolumeBundleMetafield(admin, {
        productIds,
        bundleName: name,
        volumeTiers,
        designConfig,
      });
    } else {
      // collection or all → shop-level metafield
      await setShopVolumeBundleMetafield(admin, session.shop, db);
    }
  } else {
    const bundleId = Number(params.id);
    const existing = await db.volumeBundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (!existing) {
      throw new Response("Volume bundle not found", { status: 404 });
    }

    // Remove old product metafields
    let oldProductIds: string[] = [];
    try {
      const parsed = JSON.parse(existing.productId);
      oldProductIds = Array.isArray(parsed) ? parsed : [existing.productId];
    } catch {
      oldProductIds = existing.productId ? [existing.productId] : [];
    }
    if (oldProductIds.length > 0) {
      await removeVolumeBundleMetafield(admin, oldProductIds);
    }

    await db.volumeBundle.update({
      where: { id: bundleId },
      data: {
        name,
        triggerType,
        productId: productIdField,
        triggerReference,
        volumeTiers: volumeTiersRaw,
        designConfig: designConfigRaw || null,
      },
    });

    // Set new metafields
    if (triggerType === "product") {
      await setVolumeBundleMetafield(admin, {
        productIds,
        bundleName: name,
        volumeTiers,
        designConfig,
      });
    } else {
      await setShopVolumeBundleMetafield(admin, session.shop, db);
    }

    if (existing.discountId) {
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

export default function VolumeBundleForm() {
  const { bundle, volumeTiers: loadedTiers, functionId, products: loadedProducts, collectionTitle: loadedCollectionTitle } =
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
  const [collectionTitle, setCollectionTitle] = useState(loadedCollectionTitle || "");
  const [selectedProducts, setSelectedProducts] = useState<
    Array<{ id: string; title: string; image: string; price: number }>
  >(loadedProducts || []);

  const [tiers, setTiers] = useState<VolumeTier[]>(loadedTiers);

  const updateTier = (index: number, field: keyof VolumeTier, value: string | boolean) => {
    setTiers((prev) =>
      prev.map((t, i) => {
        if (i !== index) {
          // If setting popular on another tier, unset it here
          if (field === "popular" && value === true) return { ...t, popular: false };
          return t;
        }
        if (field === "popular") return { ...t, popular: value as boolean };
        if (field === "label") return { ...t, label: value as string };
        return { ...t, [field]: Number(value) || 0 };
      }),
    );
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    setTiers((prev) => [
      ...prev,
      {
        label: "",
        qty: (last?.qty || 0) + 1,
        discountPct: (last?.discountPct || 0) + 10,
        popular: false,
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
    tiers.findIndex((t) => t.popular) >= 0 ? tiers.findIndex((t) => t.popular) : 1,
  );

  const formatPreviewPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const handleSelectProducts = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProducts.map((p) => ({ id: p.id })),
    });

    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      setSelectedProducts(
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
  }, [shopify, selectedProducts]);

  const handleSelectCollection = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: false,
    });

    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      if (items.length > 0) {
        setTriggerReference(items[0].id);
        setCollectionTitle(items[0].title || items[0].id);
      }
    }
  }, [shopify]);

  const removeProduct = (id: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmit = () => {
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Name is required");
    if (triggerType === "product" && selectedProducts.length === 0)
      validationErrors.push("At least one product is required");
    if (triggerType === "collection" && !triggerReference)
      validationErrors.push("A collection is required");
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
    formData.set("productIds", JSON.stringify(selectedProducts.map((p) => p.id)));
    formData.set("functionId", functionId);
    formData.set("volumeTiers", JSON.stringify(tiers));
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  const unitPrice = selectedProducts[0]?.price || 19900;

  return (
    <Page
      title={isNew ? "Create volume discount" : "Edit volume discount"}
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
                  Volume discount details
                </Text>
                <FormLayout>
                  <TextField
                    label="Bundle name"
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
                      if (v !== "product") setSelectedProducts([]);
                      if (v !== "collection") { setTriggerReference(""); setCollectionTitle(""); }
                    }}
                  />

                  {triggerType === "product" && (
                    <>
                      <InlineStack gap="300" blockAlign="center">
                        <Button onClick={handleSelectProducts}>
                          {selectedProducts.length > 0 ? "Change products" : "Browse products"}
                        </Button>
                      </InlineStack>
                      {selectedProducts.map((p) => (
                        <InlineStack key={p.id} gap="300" blockAlign="center">
                          {p.image && (
                            <Thumbnail source={p.image} alt={p.title} size="small" />
                          )}
                          <div style={{ flex: 1 }}>
                            <Text as="span" variant="bodyMd">{p.title}</Text>
                          </div>
                          <Button variant="plain" tone="critical" onClick={() => removeProduct(p.id)}>
                            Remove
                          </Button>
                        </InlineStack>
                      ))}
                    </>
                  )}

                  {triggerType === "collection" && (
                    <InlineStack gap="300" blockAlign="center">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Collection"
                          value={collectionTitle}
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
                      This volume discount will apply to all products in your store.
                    </Banner>
                  )}
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Volume tiers
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Each tier defines a quantity and a percentage discount applied to all units.
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
                          label="Label"
                          value={tier.label}
                          onChange={(v) => updateTier(i, "label", v)}
                          autoComplete="off"
                          placeholder="e.g. Duo"
                        />
                        <TextField
                          label="Quantity"
                          type="number"
                          value={String(tier.qty)}
                          onChange={(v) => updateTier(i, "qty", v)}
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
                          min={0}
                          max={100}
                        />
                      </FormLayout.Group>
                      <div style={{ marginTop: "8px" }}>
                        <Checkbox
                          label="Most Popular"
                          checked={tier.popular}
                          onChange={(v) => updateTier(i, "popular", v)}
                        />
                      </div>
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
                    placeholder="e.g. BUY MORE & SAVE"
                  />
                  <TextField
                    label="Popular badge text"
                    value={design.badgeText}
                    onChange={(v) => updateDesign("badgeText", v)}
                    autoComplete="off"
                    placeholder="e.g. Most Popular"
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
                {isNew ? "Create volume discount" : "Save changes"}
              </Button>
            </InlineStack>
          </BlockStack>
        </div>

        {/* -- Volume Preview -- */}
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
                    const totalOriginal = tier.qty * unitPrice;
                    const totalFinal = Math.round(totalOriginal * (1 - tier.discountPct / 100));
                    const saveAmount = totalOriginal - totalFinal;
                    const isHorizontal = design.cardLayout === "horizontal";
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedPreviewTier(i)}
                        style={{
                          position: "relative",
                          display: "flex",
                          flexDirection: isHorizontal ? "column" : "row",
                          alignItems: isHorizontal ? "center" : "center",
                          gap: isHorizontal ? "6px" : "10px",
                          padding: isHorizontal ? "14px 10px" : "12px 14px",
                          borderRadius: "12px",
                          border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #e5e5e5",
                          background: isSelected ? `${design.accentColor}08` : "#fff",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          flex: isHorizontal ? 1 : undefined,
                          textAlign: isHorizontal ? "center" : undefined,
                          minWidth: 0,
                        }}
                      >
                        {/* Popular badge */}
                        {tier.popular && design.badgeText && (
                          <div style={{
                            position: "absolute",
                            top: "-10px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            background: design.accentColor,
                            color: "#fff",
                            fontSize: "9px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            whiteSpace: "nowrap",
                            textTransform: "uppercase" as const,
                          }}>
                            {design.badgeText}
                          </div>
                        )}
                        {!isHorizontal && (
                          <div style={{ width: 20, height: 20, borderRadius: "50%", border: isSelected ? `2px solid ${design.accentColor}` : "2px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isSelected && <div style={{ width: 10, height: 10, borderRadius: "50%", background: design.accentColor }} />}
                          </div>
                        )}
                        <div style={{ flex: isHorizontal ? undefined : 1 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: design.textColor }}>
                            {tier.label || `${tier.qty} unit${tier.qty !== 1 ? "s" : ""}`}
                          </div>
                          <div style={{ fontSize: "11px", color: "#777", marginTop: "2px" }}>
                            {tier.discountPct > 0 ? `Save ${tier.discountPct}%` : "Standard"}
                          </div>
                        </div>
                        <div style={{ textAlign: isHorizontal ? "center" : "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: isHorizontal ? "13px" : "14px", color: isSelected ? design.accentColor : design.textColor }}>
                            {formatPreviewPrice(totalFinal)}
                          </div>
                          {tier.discountPct > 0 && (
                            <>
                              <div style={{ fontSize: "10px", textDecoration: "line-through", color: "#999" }}>
                                {formatPreviewPrice(totalOriginal)}
                              </div>
                              <div style={{ fontSize: "9px", fontWeight: 700, color: design.accentColor, marginTop: "2px" }}>
                                SAVE {formatPreviewPrice(saveAmount)}
                              </div>
                            </>
                          )}
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

                {/* Button */}
                <div style={{ width: "100%", padding: "12px 16px", fontSize: "14px", fontWeight: 700, border: "none", borderRadius: "8px", background: design.buttonColor, color: design.buttonTextColor, textAlign: "center", cursor: "default" }}>
                  Add to Cart
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
