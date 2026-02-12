import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  IndexTable,
  Text,
  Badge,
  EmptyState,
  useBreakpoints,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  removeBundleMetafield,
  syncShopBundlesMetafield,
} from "../lib/bundle-metafields.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const bundles = await db.bundle.findMany({
    where: { shopId: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return json({ bundles });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const bundleId = Number(formData.get("bundleId"));

  if (intent === "delete") {
    const bundle = await db.bundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (bundle?.discountId) {
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

    // Remove storefront metafield from buy product
    if (bundle && bundle.buyType === "product") {
      await removeBundleMetafield(admin, bundle.buyReference);
    }

    await db.bundle.delete({ where: { id: bundleId } });
  }

  if (intent === "toggle") {
    const bundle = await db.bundle.findFirst({
      where: { id: bundleId, shopId: session.shop },
    });

    if (bundle) {
      const newActive = !bundle.active;
      await db.bundle.update({
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
    }
  }

  // Sync shop metafield with active bundles for storefront JS
  await syncShopBundlesMetafield(admin, session.shop, db);

  return json({ ok: true });
};

export default function BundleIndex() {
  const { bundles } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { smUp } = useBreakpoints();

  const resourceName = {
    singular: "bundle",
    plural: "bundles",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(bundles.map((b) => ({ ...b, id: String(b.id) })));

  const handleDelete = (id: number) => {
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("bundleId", String(id));
    submit(formData, { method: "post" });
  };

  const handleToggle = (id: number) => {
    const formData = new FormData();
    formData.set("intent", "toggle");
    formData.set("bundleId", String(id));
    submit(formData, { method: "post" });
  };

  const formatDiscount = (type: string, value: number) => {
    return type === "percentage" ? `${value}%` : `$${value}`;
  };

  const formatBuyCondition = (buyType: string, minQty: number) => {
    return `Buy ${minQty} ${buyType === "collection" ? "from collection" : "product(s)"}`;
  };

  const emptyState = (
    <EmptyState
      heading="Create your first BXGY bundle"
      action={{
        content: "Create bundle",
        onAction: () => navigate("/app/bundles/new"),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        Set up Buy X Get Y bundles to offer automatic discounts when customers
        add qualifying products to their cart.
      </p>
    </EmptyState>
  );

  const rowMarkup = bundles.map((bundle, index) => (
    <IndexTable.Row
      id={String(bundle.id)}
      key={bundle.id}
      selected={selectedResources.includes(String(bundle.id))}
      position={index}
      onClick={() => navigate(`/app/bundles/${bundle.id}`)}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {bundle.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {formatBuyCondition(bundle.buyType, bundle.minQuantity)}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {formatDiscount(bundle.discountType, bundle.discountValue)} off
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={bundle.active ? "success" : undefined}>
          {bundle.active ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <div
          style={{ display: "flex", gap: "8px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleToggle(bundle.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--p-color-text-emphasis)",
              textDecoration: "underline",
            }}
          >
            {bundle.active ? "Deactivate" : "Activate"}
          </button>
          <button
            onClick={() => handleDelete(bundle.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--p-color-text-critical)",
              textDecoration: "underline",
            }}
          >
            Delete
          </button>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Bundles"
      primaryAction={{
        content: "Create bundle",
        onAction: () => navigate("/app/bundles/new"),
      }}
    >
      {bundles.length === 0 ? (
        emptyState
      ) : (
        <IndexTable
          condensed={!smUp}
          resourceName={resourceName}
          itemCount={bundles.length}
          selectedItemsCount={
            allResourcesSelected ? "All" : selectedResources.length
          }
          onSelectionChange={handleSelectionChange}
          headings={[
            { title: "Name" },
            { title: "Buy Condition" },
            { title: "Discount" },
            { title: "Status" },
            { title: "Actions" },
          ]}
          selectable={false}
        >
          {rowMarkup}
        </IndexTable>
      )}
    </Page>
  );
}
