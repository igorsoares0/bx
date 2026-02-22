import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Thumbnail,
  Badge,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  setBundleMetafield,
  removeBundleMetafield,
  syncShopBundlesMetafield,
} from "../lib/bundle-metafields.server";

const DEFAULT_DESIGN = {
  accentColor: "#e85d04",
  backgroundColor: "#fff8f0",
  borderColor: "#e85d04",
  textColor: "#1a1a1a",
  buttonColor: "#e85d04",
  buttonTextColor: "#ffffff",
  borderRadius: 12,
  imageSizePx: 120,
  fontSizePx: 14,
  buttonFontSizePx: 16,
  badgeText: "Bundle Deal",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch the function ID for our bxgy-discount extension
  const response = await admin.graphql(
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
  const responseJson = await response.json();
  const functions = responseJson.data?.shopifyFunctions?.nodes || [];
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
      buyReferenceTitle: "",
      buyReferenceImage: "",
      buyReferencePrice: 0,
      getProductTitle: "",
      getProductImage: "",
      getProductPrice: 0,
    });
  }

  const bundle = await db.bundle.findUnique({
    where: { id: Number(params.id) },
  });

  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  // Fetch product/collection titles, images, and prices for display in the form
  let buyReferenceTitle = bundle.buyReference;
  let buyReferenceImage = "";
  let buyReferencePrice = 0;
  let getProductTitle = bundle.getProductId;
  let getProductImage = "";
  let getProductPrice = 0;

  try {
    const [buyRes, getRes] = await Promise.all([
      bundle.buyType === "collection"
        ? admin.graphql(
            `#graphql
              query getCollection($id: ID!) {
                collection(id: $id) {
                  title
                  image { url }
                }
              }`,
            { variables: { id: bundle.buyReference } },
          )
        : admin.graphql(
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
            { variables: { id: bundle.buyReference } },
          ),
      admin.graphql(
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
        { variables: { id: bundle.getProductId } },
      ),
    ]);

    const buyJson = await buyRes.json();
    const getJson = await getRes.json();

    buyReferenceTitle =
      buyJson.data?.product?.title ||
      buyJson.data?.collection?.title ||
      bundle.buyReference;
    buyReferenceImage =
      buyJson.data?.product?.featuredImage?.url ||
      buyJson.data?.collection?.image?.url ||
      "";
    buyReferencePrice = buyJson.data?.product?.variants?.edges?.[0]?.node?.price
      ? Math.round(parseFloat(buyJson.data.product.variants.edges[0].node.price) * 100)
      : 0;
    getProductTitle =
      getJson.data?.product?.title || bundle.getProductId;
    getProductImage =
      getJson.data?.product?.featuredImage?.url || "";
    getProductPrice = getJson.data?.product?.variants?.edges?.[0]?.node?.price
      ? Math.round(parseFloat(getJson.data.product.variants.edges[0].node.price) * 100)
      : 0;
  } catch {
    // Keep GID as fallback if GraphQL fails
  }

  return json({
    bundle,
    functionId,
    buyReferenceTitle,
    buyReferenceImage,
    buyReferencePrice,
    getProductTitle,
    getProductImage,
    getProductPrice,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const buyType = formData.get("buyType") as string;
  const buyReference = formData.get("buyReference") as string;
  const minQuantity = Number(formData.get("minQuantity"));
  const getProductId = formData.get("getProductId") as string;
  const discountType = formData.get("discountType") as string;
  const discountValue = Number(formData.get("discountValue"));
  const maxReward = Number(formData.get("maxReward"));
  const designConfigRaw = formData.get("designConfig") as string | null;
  const designConfig = designConfigRaw ? JSON.parse(designConfigRaw) : null;

  // Build the function configuration JSON
  const functionConfig = {
    buyType,
    buyProductId: buyType === "product" ? buyReference : null,
    buyCollectionIds: buyType === "collection" ? [buyReference] : null,
    minQuantity,
    getProductId,
    discountType,
    discountValue,
    maxReward,
  };

  const isNew = params.id === "new";

  if (isNew) {
    // Create bundle in DB
    const bundle = await db.bundle.create({
      data: {
        name,
        buyType,
        buyReference,
        minQuantity,
        getProductId,
        discountType,
        discountValue,
        maxReward,
        shopId: session.shop,
        designConfig: designConfigRaw || null,
      },
    });

    // Create automatic discount in Shopify
    const response = await admin.graphql(
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

    const responseJson = await response.json();
    const result = responseJson.data?.discountAutomaticAppCreate;

    if (result?.userErrors?.length > 0) {
      return json(
        { errors: result.userErrors.map((e: any) => e.message) },
        { status: 400 },
      );
    }

    const discountId = result?.automaticAppDiscount?.discountId;

    if (discountId) {
      await db.bundle.update({
        where: { id: bundle.id },
        data: { discountId },
      });
    }

    // Write metafield to buy product for storefront display
    if (buyType === "product") {
      await setBundleMetafield(admin, {
        buyProductId: buyReference,
        bundleName: name,
        minQuantity,
        rewardProductId: getProductId,
        discountType,
        discountValue,
        maxReward,
        designConfig,
      });
    }
  } else {
    // Update existing bundle
    const bundleId = Number(params.id);
    const existing = await db.bundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (!existing) {
      throw new Response("Bundle not found", { status: 404 });
    }

    await db.bundle.update({
      where: { id: bundleId },
      data: {
        name,
        buyType,
        buyReference,
        minQuantity,
        getProductId,
        discountType,
        discountValue,
        maxReward,
        designConfig: designConfigRaw || null,
      },
    });

    // Update the Shopify discount
    if (existing.discountId) {
      const response = await admin.graphql(
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

      const responseJson = await response.json();
      const result = responseJson.data?.discountAutomaticAppUpdate;

      if (result?.userErrors?.length > 0) {
        return json(
          { errors: result.userErrors.map((e: any) => e.message) },
          { status: 400 },
        );
      }
    }

    // Update metafield on buy product (remove old, set new if product type)
    if (existing.buyType === "product" && existing.buyReference !== buyReference) {
      await removeBundleMetafield(admin, existing.buyReference);
    }
    if (buyType === "product") {
      await setBundleMetafield(admin, {
        buyProductId: buyReference,
        bundleName: name,
        minQuantity,
        rewardProductId: getProductId,
        discountType,
        discountValue,
        maxReward,
        designConfig,
      });
    } else if (existing.buyType === "product") {
      await removeBundleMetafield(admin, existing.buyReference);
    }
  }

  // Sync all active bundles to shop metafield for storefront JS
  await syncShopBundlesMetafield(admin, session.shop, db);

  return redirect("/app");
};

export default function BundleForm() {
  const {
    bundle,
    functionId,
    buyReferenceTitle,
    buyReferenceImage,
    buyReferencePrice,
    getProductTitle,
    getProductImage,
    getProductPrice,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";
  const isNew = !bundle;

  // Parse saved designConfig or use defaults
  const savedDesign = bundle?.designConfig
    ? { ...DEFAULT_DESIGN, ...JSON.parse(bundle.designConfig) }
    : DEFAULT_DESIGN;

  const [name, setName] = useState(bundle?.name || "");
  const [buyType, setBuyType] = useState(bundle?.buyType || "product");
  const [buyReference, setBuyReference] = useState(
    bundle?.buyReference || "",
  );
  const [buyReferenceLabel, setBuyReferenceLabel] = useState(
    buyReferenceTitle || bundle?.buyReference || "",
  );
  const [buyImage, setBuyImage] = useState(buyReferenceImage || "");
  const [minQuantity, setMinQuantity] = useState(
    String(bundle?.minQuantity || 2),
  );
  const [getProductId, setGetProductId] = useState(
    bundle?.getProductId || "",
  );
  const [getProductLabel, setGetProductLabel] = useState(
    getProductTitle || bundle?.getProductId || "",
  );
  const [getImage, setGetImage] = useState(getProductImage || "");
  const [buyPriceCents, setBuyPriceCents] = useState(buyReferencePrice || 0);
  const [getPriceCents, setGetPriceCents] = useState(getProductPrice || 0);
  const [discountType, setDiscountType] = useState(
    bundle?.discountType || "percentage",
  );
  const [discountValue, setDiscountValue] = useState(
    String(bundle?.discountValue || ""),
  );
  const [maxReward, setMaxReward] = useState(
    String(bundle?.maxReward || 1),
  );
  const [errors, setErrors] = useState<string[]>([]);

  // Design state
  const [design, setDesign] = useState(savedDesign);
  const updateDesign = (key: string, value: string | number) => {
    setDesign((prev: typeof DEFAULT_DESIGN) => ({ ...prev, [key]: value }));
  };

  /* ── Preview helpers ── */
  const previewDiscountLabel =
    discountType === "percentage"
      ? `${discountValue || 0}% off`
      : `$${discountValue || 0} off`;

  const formatPreviewPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const discountedRewardCents =
    getPriceCents > 0
      ? discountType === "percentage"
        ? Math.round(getPriceCents * (1 - Number(discountValue || 0) / 100))
        : Math.max(0, getPriceCents - Number(discountValue || 0) * 100)
      : 0;

  const totalOriginalCents =
    buyPriceCents * Number(minQuantity || 1) + getPriceCents;
  const totalFinalCents =
    buyPriceCents * Number(minQuantity || 1) + discountedRewardCents;
  const savingsCents = totalOriginalCents - totalFinalCents;
  const hasPrices = buyPriceCents > 0 || getPriceCents > 0;

  const handleSelectBuyProduct = useCallback(async () => {
    const type = buyType === "collection" ? "collection" : "product";
    const selected = await shopify.resourcePicker({
      type,
      multiple: false,
    });

    if (selected) {
      const item = selected as any;
      const items = Array.isArray(item) ? item : [item];
      if (items.length > 0) {
        setBuyReference(items[0].id);
        setBuyReferenceLabel(items[0].title || items[0].id);
        setBuyImage(
          items[0].images?.[0]?.originalSrc ||
            items[0].image?.originalSrc ||
            "",
        );
        const firstVariant = items[0].variants?.[0];
        if (firstVariant?.price) {
          setBuyPriceCents(Math.round(parseFloat(firstVariant.price) * 100));
        }
      }
    }
  }, [shopify, buyType]);

  const handleSelectGetProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });

    if (selected) {
      const item = selected as any;
      const items = Array.isArray(item) ? item : [item];
      if (items.length > 0) {
        setGetProductId(items[0].id);
        setGetProductLabel(items[0].title || items[0].id);
        setGetImage(items[0].images?.[0]?.originalSrc || "");
        const firstVariant = items[0].variants?.[0];
        if (firstVariant?.price) {
          setGetPriceCents(Math.round(parseFloat(firstVariant.price) * 100));
        }
      }
    }
  }, [shopify]);

  const handleSubmit = () => {
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Name is required");
    if (!buyReference) validationErrors.push("Buy product/collection is required");
    if (!getProductId) validationErrors.push("Reward product is required");
    if (!discountValue || Number(discountValue) <= 0)
      validationErrors.push("Discount value must be greater than 0");
    if (Number(minQuantity) < 1)
      validationErrors.push("Minimum quantity must be at least 1");
    if (Number(maxReward) < 1)
      validationErrors.push("Max reward must be at least 1");

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("buyType", buyType);
    formData.set("buyReference", buyReference);
    formData.set("minQuantity", minQuantity);
    formData.set("getProductId", getProductId);
    formData.set("discountType", discountType);
    formData.set("discountValue", discountValue);
    formData.set("maxReward", maxReward);
    formData.set("functionId", functionId);
    formData.set("designConfig", JSON.stringify(design));

    submit(formData, { method: "post" });
  };

  /* ── Preview image size (scaled for the small preview) ── */
  const previewImageSize = Math.min(Math.max(design.imageSizePx * 0.67, 40), 120);

  return (
    <Page
      title={isNew ? "Create bundle" : "Edit bundle"}
      backAction={{ url: "/app" }}
    >
      <Layout>
        <Layout.Section>
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
                    placeholder="e.g. Buy 2 shirts, get a hat 50% off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Buy condition
                </Text>
                <FormLayout>
                  <Select
                    label="Buy type"
                    options={[
                      { label: "Specific product", value: "product" },
                      { label: "From collection", value: "collection" },
                    ]}
                    value={buyType}
                    onChange={setBuyType}
                  />
                  <InlineStack gap="300" blockAlign="center">
                    {buyImage && (
                      <Thumbnail
                        source={buyImage}
                        alt={buyReferenceLabel}
                        size="medium"
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <TextField
                        label={
                          buyType === "collection"
                            ? "Collection"
                            : "Product"
                        }
                        value={buyReferenceLabel}
                        readOnly
                        autoComplete="off"
                        placeholder="Select a product or collection..."
                      />
                    </div>
                    <Button onClick={handleSelectBuyProduct}>
                      Browse
                    </Button>
                  </InlineStack>
                  <TextField
                    label="Minimum quantity"
                    type="number"
                    value={minQuantity}
                    onChange={setMinQuantity}
                    autoComplete="off"
                    min={1}
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Reward (Get Y)
                </Text>
                <FormLayout>
                  <InlineStack gap="300" blockAlign="center">
                    {getImage && (
                      <Thumbnail
                        source={getImage}
                        alt={getProductLabel}
                        size="medium"
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Reward product"
                        value={getProductLabel}
                        readOnly
                        autoComplete="off"
                        placeholder="Select a product..."
                      />
                    </div>
                    <Button onClick={handleSelectGetProduct}>
                      Browse
                    </Button>
                  </InlineStack>
                  <Select
                    label="Discount type"
                    options={[
                      { label: "Percentage", value: "percentage" },
                      { label: "Fixed amount", value: "fixed" },
                    ]}
                    value={discountType}
                    onChange={setDiscountType}
                  />
                  <TextField
                    label={
                      discountType === "percentage"
                        ? "Discount percentage"
                        : "Discount amount ($)"
                    }
                    type="number"
                    value={discountValue}
                    onChange={setDiscountValue}
                    autoComplete="off"
                    suffix={discountType === "percentage" ? "%" : "$"}
                    min={0}
                  />
                  <TextField
                    label="Max reward quantity"
                    type="number"
                    value={maxReward}
                    onChange={setMaxReward}
                    autoComplete="off"
                    helpText="Maximum number of reward items to discount"
                    min={1}
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            {/* ── Design Section ── */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Design
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Customize the widget appearance for this bundle
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
                        <TextField
                          label=""
                          labelHidden
                          value={design.accentColor}
                          onChange={(v) => updateDesign("accentColor", v)}
                          autoComplete="off"
                        />
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
                        <TextField
                          label=""
                          labelHidden
                          value={design.backgroundColor}
                          onChange={(v) => updateDesign("backgroundColor", v)}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <div>
                      <Text as="p" variant="bodySm">Border color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.borderColor}
                          onChange={(e) => updateDesign("borderColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={design.borderColor}
                          onChange={(v) => updateDesign("borderColor", v)}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">Text color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.textColor}
                          onChange={(e) => updateDesign("textColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={design.textColor}
                          onChange={(v) => updateDesign("textColor", v)}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <div>
                      <Text as="p" variant="bodySm">Button color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.buttonColor}
                          onChange={(e) => updateDesign("buttonColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={design.buttonColor}
                          onChange={(v) => updateDesign("buttonColor", v)}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">Button text color</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={design.buttonTextColor}
                          onChange={(e) => updateDesign("buttonTextColor", e.target.value)}
                          style={{ width: 36, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={design.buttonTextColor}
                          onChange={(v) => updateDesign("buttonTextColor", v)}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </div>
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Border radius"
                      type="number"
                      value={String(design.borderRadius)}
                      onChange={(v) => updateDesign("borderRadius", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={0}
                    />
                    <TextField
                      label="Image size"
                      type="number"
                      value={String(design.imageSizePx)}
                      onChange={(v) => updateDesign("imageSizePx", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={40}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Font size"
                      type="number"
                      value={String(design.fontSizePx)}
                      onChange={(v) => updateDesign("fontSizePx", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={10}
                    />
                    <TextField
                      label="Button font size"
                      type="number"
                      value={String(design.buttonFontSizePx)}
                      onChange={(v) => updateDesign("buttonFontSizePx", Number(v))}
                      autoComplete="off"
                      suffix="px"
                      min={10}
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Badge text"
                    value={design.badgeText}
                    onChange={(v) => updateDesign("badgeText", v)}
                    autoComplete="off"
                    placeholder="e.g. Bundle Deal"
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
                {isNew ? "Create bundle" : "Save changes"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* ── Theme Preview ── */}
        <Layout.Section variant="oneThird">
          <div style={{ position: "sticky", top: 20 }}>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Theme preview
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Approximate preview of the storefront widget
                </Text>

                {/* Preview widget */}
                <div
                  style={{
                    border: `2px solid ${design.borderColor}`,
                    borderRadius: `${design.borderRadius}px`,
                    padding: "16px",
                    background: design.backgroundColor,
                    fontFamily: "inherit",
                  }}
                >
                  {/* Badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      marginBottom: "12px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                    >
                      <path
                        d="M10 2L12.09 7.26L18 8.27L14 12.14L14.81 18.02L10 15.27L5.19 18.02L6 12.14L2 8.27L7.91 7.26L10 2Z"
                        fill={design.accentColor}
                      />
                    </svg>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "11px",
                        color: design.accentColor,
                        textTransform: "uppercase" as const,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {design.badgeText}
                    </span>
                  </div>

                  {/* Product cards */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      gap: "0",
                      marginBottom: "12px",
                    }}
                  >
                    {/* Buy product */}
                    <div
                      style={{
                        flex: 1,
                        background: "#fff",
                        border: "1px solid #e5e5e5",
                        borderRadius: "8px",
                        padding: "10px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          textTransform: "uppercase" as const,
                          color: "#666",
                          marginBottom: "6px",
                          letterSpacing: "0.3px",
                        }}
                      >
                        Buy
                      </div>
                      {buyImage ? (
                        <img
                          src={buyImage}
                          alt={buyReferenceLabel}
                          style={{
                            width: "100%",
                            maxWidth: `${previewImageSize}px`,
                            aspectRatio: "1",
                            objectFit: "cover",
                            borderRadius: "6px",
                            background: "#f5f5f5",
                            marginBottom: "8px",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: `${previewImageSize}px`,
                            height: `${previewImageSize}px`,
                            borderRadius: "6px",
                            background: "#f0f0f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginBottom: "8px",
                            color: "#999",
                            fontSize: "10px",
                          }}
                        >
                          No image
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: `${Math.round(design.fontSizePx * 0.85)}px`,
                          fontWeight: 600,
                          color: design.textColor,
                          marginBottom: "3px",
                          lineHeight: "1.3",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {buyReferenceLabel || "Buy Product"}
                      </div>
                      <div
                        style={{
                          fontSize: `${Math.round(design.fontSizePx * 0.85)}px`,
                          fontWeight: 600,
                          color: design.textColor,
                          marginBottom: "3px",
                        }}
                      >
                        {buyPriceCents > 0
                          ? formatPreviewPrice(buyPriceCents)
                          : "\u2014"}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#666",
                          background: "#f5f5f5",
                          padding: "2px 8px",
                          borderRadius: "10px",
                        }}
                      >
                        Qty: {minQuantity || 1}
                      </div>
                    </div>

                    {/* Plus */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 8px",
                        fontSize: "20px",
                        fontWeight: 700,
                        color: design.accentColor,
                      }}
                    >
                      +
                    </div>

                    {/* Reward product */}
                    <div
                      style={{
                        flex: 1,
                        background: "#fff",
                        border: "1px solid #e5e5e5",
                        borderRadius: "8px",
                        padding: "10px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          textTransform: "uppercase" as const,
                          color: design.accentColor,
                          marginBottom: "6px",
                          letterSpacing: "0.3px",
                        }}
                      >
                        Get {previewDiscountLabel}
                      </div>
                      {getImage ? (
                        <img
                          src={getImage}
                          alt={getProductLabel}
                          style={{
                            width: "100%",
                            maxWidth: `${previewImageSize}px`,
                            aspectRatio: "1",
                            objectFit: "cover",
                            borderRadius: "6px",
                            background: "#f5f5f5",
                            marginBottom: "8px",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: `${previewImageSize}px`,
                            height: `${previewImageSize}px`,
                            borderRadius: "6px",
                            background: "#f0f0f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginBottom: "8px",
                            color: "#999",
                            fontSize: "10px",
                          }}
                        >
                          No image
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: `${Math.round(design.fontSizePx * 0.85)}px`,
                          fontWeight: 600,
                          color: design.textColor,
                          marginBottom: "3px",
                          lineHeight: "1.3",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {getProductLabel || "Reward Product"}
                      </div>
                      <div style={{ fontSize: `${Math.round(design.fontSizePx * 0.85)}px`, marginBottom: "3px" }}>
                        {getPriceCents > 0 ? (
                          discountedRewardCents < getPriceCents ? (
                            <>
                              <span
                                style={{
                                  textDecoration: "line-through",
                                  color: "#999",
                                  fontWeight: 400,
                                  marginRight: "4px",
                                }}
                              >
                                {formatPreviewPrice(getPriceCents)}
                              </span>
                              <span
                                style={{
                                  color: "#e53e3e",
                                  fontWeight: 700,
                                }}
                              >
                                {formatPreviewPrice(discountedRewardCents)}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontWeight: 600, color: design.textColor }}>
                              {formatPreviewPrice(getPriceCents)}
                            </span>
                          )
                        ) : (
                          <span style={{ color: "#999" }}>{"\u2014"}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div
                    style={{
                      textAlign: "center",
                      marginBottom: "10px",
                      padding: "8px",
                      background: "#f9f9f9",
                      borderRadius: "6px",
                    }}
                  >
                    {hasPrices ? (
                      <>
                        <div style={{ fontSize: "13px", marginBottom: "2px" }}>
                          {savingsCents > 0 && (
                            <span
                              style={{
                                textDecoration: "line-through",
                                color: "#999",
                                marginRight: "6px",
                              }}
                            >
                              {formatPreviewPrice(totalOriginalCents)}
                            </span>
                          )}
                          <span style={{ fontWeight: 700, color: design.textColor }}>
                            {formatPreviewPrice(totalFinalCents)}
                          </span>
                        </div>
                        {savingsCents > 0 && (
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#16a34a",
                            }}
                          >
                            You save {formatPreviewPrice(savingsCents)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#999",
                        }}
                      >
                        Select products to see prices
                      </div>
                    )}
                  </div>

                  {/* Button */}
                  <div
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      fontSize: `${Math.round(design.buttonFontSizePx * 0.8)}px`,
                      fontWeight: 700,
                      border: "none",
                      borderRadius: "6px",
                      background: design.buttonColor,
                      color: design.buttonTextColor,
                      textAlign: "center",
                      cursor: "default",
                    }}
                  >
                    Add Bundle to Cart
                  </div>

                  {/* Footer */}
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: "10px",
                      color: "#888",
                      marginTop: "8px",
                    }}
                  >
                    Discount applied automatically at checkout
                  </div>
                </div>

                {/* Info note */}
                <Text as="p" variant="bodySm" tone="subdued">
                  Prices are based on the first variant of each product. On the
                  storefront, prices update when the customer changes variants.
                </Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
