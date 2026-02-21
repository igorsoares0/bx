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
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  setBundleMetafield,
  removeBundleMetafield,
  syncShopBundlesMetafield,
} from "../lib/bundle-metafields.server";

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
      getProductTitle: "",
      getProductImage: "",
    });
  }

  const bundle = await db.bundle.findUnique({
    where: { id: Number(params.id) },
  });

  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  // Fetch product/collection titles and images for display in the form
  let buyReferenceTitle = bundle.buyReference;
  let buyReferenceImage = "";
  let getProductTitle = bundle.getProductId;
  let getProductImage = "";

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
    getProductTitle =
      getJson.data?.product?.title || bundle.getProductId;
    getProductImage =
      getJson.data?.product?.featuredImage?.url || "";
  } catch {
    // Keep GID as fallback if GraphQL fails
  }

  return json({
    bundle,
    functionId,
    buyReferenceTitle,
    buyReferenceImage,
    getProductTitle,
    getProductImage,
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
    getProductTitle,
    getProductImage,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";
  const isNew = !bundle;

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

    submit(formData, { method: "post" });
  };

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
      </Layout>
    </Page>
  );
}
