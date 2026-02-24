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
  setComplementBundleMetafield,
  removeComplementBundleMetafield,
  setShopComplementBundleMetafield,
} from "../lib/bundle-metafields.server";

type ComplementItem = {
  productId: string;
  title: string;
  handle: string;
  image: string;
  price: number; // cents
  variantId: string;
  discountPct: number;
  quantity: number;
};

const DEFAULT_DESIGN = {
  accentColor: "#2563eb",
  backgroundColor: "#f0f6ff",
  textColor: "#1a1a1a",
  buttonColor: "#2563eb",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  headerText: "FREQUENTLY BOUGHT TOGETHER",
  cardLayout: "vertical",
};

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
      complements: [] as ComplementItem[],
      functionId,
      triggerTitle: "",
      triggerImage: "",
    });
  }

  const bundle = await db.complementBundle.findUnique({
    where: { id: Number(params.id) },
  });

  if (!bundle) {
    throw new Response("Complement bundle not found", { status: 404 });
  }

  let complements: ComplementItem[] = [];
  try {
    complements = JSON.parse(bundle.complements || "[]");
  } catch {}

  let triggerTitle = bundle.triggerReference || "";
  let triggerImage = "";

  if (bundle.triggerType === "product" && bundle.triggerReference) {
    try {
      const res = await admin.graphql(
        `#graphql
          query getProduct($id: ID!) {
            product(id: $id) {
              title
              featuredImage { url }
            }
          }`,
        { variables: { id: bundle.triggerReference } },
      );
      const prodJson = await res.json();
      triggerTitle = prodJson.data?.product?.title || bundle.triggerReference;
      triggerImage = prodJson.data?.product?.featuredImage?.url || "";
    } catch {}
  } else if (bundle.triggerType === "collection" && bundle.triggerReference) {
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

  return json({ bundle, complements, functionId, triggerTitle, triggerImage });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const triggerType = formData.get("triggerType") as string;
  const triggerReference = (formData.get("triggerReference") as string) || null;
  const complementsRaw = formData.get("complements") as string;
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  const complements: ComplementItem[] = JSON.parse(complementsRaw);

  // Build function config for the Rust discount function.
  // Use a dummy getProductId that will never match any real product so the
  // classic BXGY / tiered / volume paths are guaranteed to be no-ops.
  const functionConfig: Record<string, unknown> = {
    buyType: "product",
    buyProductId: null,
    buyCollectionIds: null,
    minQuantity: 999999,
    getProductId: "gid://shopify/Product/0",
    discountType: "percentage",
    discountValue: 0,
    maxReward: 0,
    complementProducts: complements.map((c) => ({
      productId: c.productId,
      discountPct: c.discountPct,
      quantity: c.quantity || 1,
    })),
    triggerProductId: triggerType === "product" && triggerReference
      ? triggerReference
      : null,
  };

  const isNew = params.id === "new";

  if (isNew) {
    const bundle = await db.complementBundle.create({
      data: {
        name,
        triggerType,
        triggerReference,
        complements: complementsRaw,
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
      await db.complementBundle.update({
        where: { id: bundle.id },
        data: { discountId },
      });
    }

    // Set metafield on trigger product (product trigger only)
    if (triggerType === "product" && triggerReference) {
      await setComplementBundleMetafield(admin, {
        productId: triggerReference,
        bundleName: name,
        complements,
        designConfig,
      });
    }

    // Sync shop-level metafield for collection/all triggers
    await setShopComplementBundleMetafield(admin, session.shop, db);
  } else {
    const bundleId = Number(params.id);
    const existing = await db.complementBundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (!existing) {
      throw new Response("Complement bundle not found", { status: 404 });
    }

    await db.complementBundle.update({
      where: { id: bundleId },
      data: {
        name,
        triggerType,
        triggerReference,
        complements: complementsRaw,
        designConfig: designConfigRaw || null,
      },
    });

    // Clean old metafield if trigger product changed
    if (
      existing.triggerType === "product" &&
      existing.triggerReference &&
      existing.triggerReference !== triggerReference
    ) {
      await removeComplementBundleMetafield(admin, existing.triggerReference);
    }

    // Set metafield on trigger product
    if (triggerType === "product" && triggerReference) {
      await setComplementBundleMetafield(admin, {
        productId: triggerReference,
        bundleName: name,
        complements,
        designConfig,
      });
    }

    // Sync shop-level metafield
    await setShopComplementBundleMetafield(admin, session.shop, db);

    // Update existing discount function config
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

export default function ComplementBundleForm() {
  const { bundle, complements: loadedComplements, functionId, triggerTitle, triggerImage } =
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
  const [triggerLabel, setTriggerLabel] = useState(triggerTitle || "");
  const [triggerImg, setTriggerImg] = useState(triggerImage || "");
  const [complements, setComplements] = useState<ComplementItem[]>(loadedComplements);
  const [design, setDesign] = useState(savedDesign);
  const [errors, setErrors] = useState<string[]>([]);

  const updateDesign = (key: string, value: string | number) => {
    setDesign((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSelectTriggerProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      if (items.length > 0) {
        setTriggerReference(items[0].id);
        setTriggerLabel(items[0].title || items[0].id);
        setTriggerImg(items[0].images?.[0]?.originalSrc || "");
        const firstVariant = (items[0] as any).variants?.[0];
      }
    }
  }, [shopify]);

  const handleSelectTriggerCollection = useCallback(async () => {
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

  const handleAddComplement = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    if (selected) {
      const items = Array.isArray(selected) ? selected : [selected];
      const newItems: ComplementItem[] = items
        .filter((item: any) => !complements.some((c) => c.productId === item.id))
        .map((item: any) => {
          const firstVariant = item.variants?.[0];
          const variantGid = firstVariant?.id || "";
          const numericVariantId = variantGid.replace("gid://shopify/ProductVariant/", "");
          return {
            productId: item.id,
            title: item.title || "",
            handle: item.handle || "",
            image: item.images?.[0]?.originalSrc || "",
            price: firstVariant?.price ? Math.round(parseFloat(firstVariant.price) * 100) : 0,
            variantId: numericVariantId,
            discountPct: 10,
            quantity: 1,
          };
        });
      setComplements((prev) => [...prev, ...newItems]);
    }
  }, [shopify, complements]);

  const updateComplementDiscount = (index: number, value: string) => {
    setComplements((prev) =>
      prev.map((c, i) => (i === index ? { ...c, discountPct: Number(value) || 0 } : c)),
    );
  };

  const updateComplementQuantity = (index: number, value: string) => {
    setComplements((prev) =>
      prev.map((c, i) => (i === index ? { ...c, quantity: Math.max(1, Number(value) || 1) } : c)),
    );
  };

  const removeComplement = (index: number) => {
    setComplements((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Name is required");
    if (triggerType !== "all" && !triggerReference) {
      validationErrors.push(
        triggerType === "product" ? "Trigger product is required" : "Trigger collection is required",
      );
    }
    if (complements.length === 0) validationErrors.push("At least one complement product is required");

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("triggerType", triggerType);
    formData.set("triggerReference", triggerReference);
    formData.set("functionId", functionId);
    formData.set("complements", JSON.stringify(complements));
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  const formatPreviewPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  // Preview calculations (complements only, trigger product is already on PDP)
  const totalOriginal = complements.reduce((sum, c) => sum + (c.price || 1990) * (c.quantity || 1), 0);
  const totalFinal = complements.reduce((sum, c) => {
    const p = c.price || 1990;
    const qty = c.quantity || 1;
    return sum + Math.round(p * (1 - c.discountPct / 100)) * qty;
  }, 0);
  const totalSave = totalOriginal - totalFinal;

  return (
    <Page
      title={isNew ? "Create FBT bundle" : "Edit FBT bundle"}
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
                  Bundle details
                </Text>
                <FormLayout>
                  <TextField
                    label="Bundle name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    placeholder="e.g. Phone + Accessories"
                  />
                  <Select
                    label="Trigger type"
                    options={[
                      { label: "Specific product", value: "product" },
                      { label: "Collection", value: "collection" },
                      { label: "All products", value: "all" },
                    ]}
                    value={triggerType}
                    onChange={(v) => {
                      setTriggerType(v);
                      setTriggerReference("");
                      setTriggerLabel("");
                      setTriggerImg("");
                    }}
                  />
                  {triggerType === "product" && (
                    <InlineStack gap="300" blockAlign="center">
                      {triggerImg && (
                        <Thumbnail source={triggerImg} alt={triggerLabel} size="medium" />
                      )}
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Trigger product"
                          value={triggerLabel}
                          readOnly
                          autoComplete="off"
                          placeholder="Select a product..."
                        />
                      </div>
                      <Button onClick={handleSelectTriggerProduct}>Browse</Button>
                    </InlineStack>
                  )}
                  {triggerType === "collection" && (
                    <InlineStack gap="300" blockAlign="center">
                      {triggerImg && (
                        <Thumbnail source={triggerImg} alt={triggerLabel} size="medium" />
                      )}
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Trigger collection"
                          value={triggerLabel}
                          readOnly
                          autoComplete="off"
                          placeholder="Select a collection..."
                        />
                      </div>
                      <Button onClick={handleSelectTriggerCollection}>Browse</Button>
                    </InlineStack>
                  )}
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Complement products
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Products shown alongside the trigger product. Each has its own discount percentage.
                </Text>

                {complements.map((comp, i) => (
                  <div
                    key={comp.productId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px",
                      border: "1px solid #e5e5e5",
                      borderRadius: "8px",
                    }}
                  >
                    {comp.image ? (
                      <Thumbnail source={comp.image} alt={comp.title} size="small" />
                    ) : (
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          background: "#f0f0f0",
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          color: "#999",
                        }}
                      >
                        N/A
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {comp.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {formatPreviewPrice(comp.price)}
                      </Text>
                    </div>
                    <div style={{ width: 60 }}>
                      <TextField
                        label="Qty"
                        labelHidden
                        type="number"
                        value={String(comp.quantity || 1)}
                        onChange={(v) => updateComplementQuantity(i, v)}
                        autoComplete="off"
                        prefix="×"
                        min={1}
                        max={99}
                      />
                    </div>
                    <div style={{ width: 100 }}>
                      <TextField
                        label="Discount %"
                        labelHidden
                        type="number"
                        value={String(comp.discountPct)}
                        onChange={(v) => updateComplementDiscount(i, v)}
                        autoComplete="off"
                        suffix="%"
                        min={0}
                        max={100}
                      />
                    </div>
                    <Button variant="plain" tone="critical" onClick={() => removeComplement(i)}>
                      Remove
                    </Button>
                  </div>
                ))}

                <InlineStack align="start">
                  <Button onClick={handleAddComplement}>Add product</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Design Section */}
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
                    placeholder="e.g. FREQUENTLY BOUGHT TOGETHER"
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
                {isNew ? "Create FBT bundle" : "Save changes"}
              </Button>
            </InlineStack>
          </BlockStack>
        </div>

        {/* FBT Preview */}
        <div style={{ width: 360, flexShrink: 0, position: "sticky", top: 20, alignSelf: "flex-start" }}>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme preview
              </Text>

              <div
                style={{
                  background: design.backgroundColor,
                  borderRadius: `${design.borderRadius}px`,
                  padding: "16px",
                  border: "1px solid #e5e5e5",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "12px",
                    color: design.textColor,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.5px",
                    marginBottom: "12px",
                    textAlign: "center",
                  }}
                >
                  {design.headerText}
                </div>

                {/* Complement cards */}
                {design.cardLayout === "horizontal" ? (
                  <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginBottom: "8px" }}>
                    {complements.map((comp, i) => {
                      const qty = comp.quantity || 1;
                      const originalPrice = (comp.price || 1990) * qty;
                      const discountedPrice = Math.round((comp.price || 1990) * (1 - comp.discountPct / 100)) * qty;
                      return (
                        <div key={comp.productId} style={{ display: "contents" }}>
                          {i > 0 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px", fontSize: "16px", fontWeight: 700, color: design.accentColor, flexShrink: 0 }}>+</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: "8px", border: "1px solid #e5e5e5", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                            <div style={{ width: 50, height: 50, borderRadius: 6, background: comp.image ? undefined : "#f0f0f0", backgroundImage: comp.image ? `url(${comp.image})` : undefined, backgroundSize: "cover", backgroundPosition: "center", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", marginBottom: 6 }}>
                              {!comp.image && "IMG"}
                            </div>
                            <div style={{ fontSize: "11px", fontWeight: 600, color: design.textColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", marginBottom: 2 }}>
                              {qty > 1 && <span style={{ color: design.accentColor }}>{qty}× </span>}
                              {comp.title || "Product"}
                            </div>
                            {comp.discountPct > 0 && (
                              <span style={{ display: "inline-block", fontSize: "9px", fontWeight: 700, color: "#fff", background: design.accentColor, padding: "1px 5px", borderRadius: "3px", marginBottom: 2 }}>SAVE {comp.discountPct}%</span>
                            )}
                            <div style={{ fontSize: "12px" }}>
                              {comp.discountPct > 0 ? (
                                <>
                                  <div style={{ fontSize: "10px", textDecoration: "line-through", color: "#999" }}>{formatPreviewPrice(originalPrice)}</div>
                                  <div style={{ fontWeight: 700, color: design.accentColor }}>{formatPreviewPrice(discountedPrice)}</div>
                                </>
                              ) : (
                                <div style={{ fontWeight: 700, color: design.textColor }}>{formatPreviewPrice(originalPrice)}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  complements.map((comp, i) => {
                    const qty = comp.quantity || 1;
                    const originalPrice = (comp.price || 1990) * qty;
                    const discountedPrice = Math.round((comp.price || 1990) * (1 - comp.discountPct / 100)) * qty;
                    return (
                      <div key={comp.productId}>
                        {i > 0 && (
                          <div style={{ textAlign: "center", fontSize: "18px", fontWeight: 700, color: design.accentColor, margin: "4px 0" }}>+</div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: "#fff", borderRadius: "8px", border: "1px solid #e5e5e5", marginBottom: i < complements.length - 1 ? "0" : "8px" }}>
                          <div style={{ width: 50, height: 50, borderRadius: 6, background: comp.image ? undefined : "#f0f0f0", backgroundImage: comp.image ? `url(${comp.image})` : undefined, backgroundSize: "cover", backgroundPosition: "center", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999" }}>
                            {!comp.image && "IMG"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: design.textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {qty > 1 && <span style={{ color: design.accentColor, marginRight: 4 }}>{qty}×</span>}
                              {comp.title || "Product"}
                            </div>
                            {comp.discountPct > 0 && (
                              <span style={{ display: "inline-block", fontSize: "10px", fontWeight: 700, color: "#fff", background: design.accentColor, padding: "1px 6px", borderRadius: "4px", marginTop: "2px" }}>SAVE {comp.discountPct}%</span>
                            )}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            {comp.discountPct > 0 ? (
                              <>
                                <div style={{ fontSize: "11px", textDecoration: "line-through", color: "#999" }}>{formatPreviewPrice(originalPrice)}</div>
                                <div style={{ fontWeight: 700, fontSize: "13px", color: design.accentColor }}>{formatPreviewPrice(discountedPrice)}</div>
                              </>
                            ) : (
                              <div style={{ fontWeight: 700, fontSize: "13px", color: design.textColor }}>{formatPreviewPrice(originalPrice)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {complements.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px",
                      color: "#999",
                      fontSize: "12px",
                    }}
                  >
                    Add complement products to see preview
                  </div>
                )}

                {/* Summary bar */}
                {complements.length > 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "10px",
                      background: "#f9f9f9",
                      borderRadius: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ fontSize: "14px" }}>
                      {totalSave > 0 && (
                        <span style={{ textDecoration: "line-through", color: "#999", marginRight: 6 }}>
                          {formatPreviewPrice(totalOriginal)}
                        </span>
                      )}
                      <span style={{ fontWeight: 700, color: design.textColor }}>
                        {formatPreviewPrice(totalFinal)}
                      </span>
                    </div>
                    {totalSave > 0 && (
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#16a34a", marginTop: 2 }}>
                        You save {formatPreviewPrice(totalSave)}
                      </div>
                    )}
                  </div>
                )}

                {/* Button */}
                <div
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    fontSize: "14px",
                    fontWeight: 700,
                    border: "none",
                    borderRadius: "8px",
                    background: design.buttonColor,
                    color: design.buttonTextColor,
                    textAlign: "center",
                    cursor: "default",
                  }}
                >
                  Add All to Cart
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
