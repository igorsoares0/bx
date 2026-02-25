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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  removeTieredBundleMetafield,
  removeVolumeBundleMetafield,
  removeComplementBundleMetafield,
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
        await removeTieredBundleMetafield(admin, bundle.productId);
        await db.tieredBundle.delete({ where: { id: bundleId } });
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
          await removeTieredBundleMetafield(admin, bundle.productId);
        }
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
        await removeVolumeBundleMetafield(admin, bundle.productId);
        await db.volumeBundle.delete({ where: { id: bundleId } });
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
          await removeVolumeBundleMetafield(admin, bundle.productId);
        }
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
          await removeComplementBundleMetafield(admin, bundle.triggerReference);
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
          await removeComplementBundleMetafield(admin, bundle.triggerReference);
        }
        await setShopComplementBundleMetafield(admin, session.shop, db);
      }
    }

    return json({ ok: true });
  }

  return json({ ok: true });
};

export default function BundleIndex() {
  const { tieredBundles, volumeBundles, complementBundles } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { smUp } = useBreakpoints();

  const handleDelete = (id: number, type: "tiered" | "volume" | "complement" = "tiered") => {
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("bundleId", String(id));
    formData.set("bundleType", type);
    submit(formData, { method: "post" });
  };

  const handleToggle = (id: number, type: "tiered" | "volume" | "complement" = "tiered") => {
    const formData = new FormData();
    formData.set("intent", "toggle");
    formData.set("bundleId", String(id));
    formData.set("bundleType", type);
    submit(formData, { method: "post" });
  };

  const hasNoBundles = tieredBundles.length === 0 && volumeBundles.length === 0 && complementBundles.length === 0;

  const emptyState = (
    <EmptyState
      heading="Create your first bundle"
      action={{
        content: "Create FBT bundle",
        onAction: () => navigate("/app/complement/new"),
      }}
      secondaryAction={{
        content: "Create tiered combo",
        onAction: () => navigate("/app/tiers/new"),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        Set up FBT/Combo bundles, tiered combo deals, or volume discounts
        to offer automatic discounts when customers add qualifying products to their cart.
      </p>
    </EmptyState>
  );

  const tieredRows = tieredBundles.map((bundle, index) => (
    <IndexTable.Row
      id={`tiered-${bundle.id}`}
      key={`tiered-${bundle.id}`}
      selected={false}
      position={index}
      onClick={() => navigate(`/app/tiers/${bundle.id}`)}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {bundle.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">Tiered</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(() => {
          try {
            const t = JSON.parse(bundle.tiersConfig || "[]");
            return `${t.length} tier${t.length !== 1 ? "s" : ""}`;
          } catch { return "—"; }
        })()}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(() => {
          try {
            const t = JSON.parse(bundle.tiersConfig || "[]") as Array<{ buyQty: number; freeQty: number }>;
            return t.map((tier: { buyQty: number; freeQty: number }) => `${tier.buyQty}+${tier.freeQty}`).join(", ");
          } catch { return "—"; }
        })()}
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
            onClick={() => handleToggle(bundle.id, "tiered")}
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
            onClick={() => handleDelete(bundle.id, "tiered")}
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

  const volumeRows = volumeBundles.map((bundle, index) => (
    <IndexTable.Row
      id={`volume-${bundle.id}`}
      key={`volume-${bundle.id}`}
      selected={false}
      position={tieredBundles.length + index}
      onClick={() => navigate(`/app/volume/${bundle.id}`)}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {bundle.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="warning">Volume</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(() => {
          try {
            const t = JSON.parse(bundle.volumeTiers || "[]");
            return `${t.length} tier${t.length !== 1 ? "s" : ""}`;
          } catch { return "—"; }
        })()}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(() => {
          try {
            const t = JSON.parse(bundle.volumeTiers || "[]") as Array<{ label: string; qty: number }>;
            return t.map((tier) => tier.label || `${tier.qty}x`).join(", ");
          } catch { return "—"; }
        })()}
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
            onClick={() => handleToggle(bundle.id, "volume")}
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
            onClick={() => handleDelete(bundle.id, "volume")}
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

  const complementRows = complementBundles.map((bundle, index) => (
    <IndexTable.Row
      id={`complement-${bundle.id}`}
      key={`complement-${bundle.id}`}
      selected={false}
      position={tieredBundles.length + volumeBundles.length + index}
      onClick={() => navigate(`/app/complement/${bundle.id}`)}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {bundle.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(bundle as any).mode === "combo"
          ? <Badge tone="success">Combo</Badge>
          : <Badge tone="magic">FBT</Badge>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {bundle.triggerType === "product"
          ? "Specific product"
          : bundle.triggerType === "collection"
            ? "Collection"
            : "All products"}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {(() => {
          try {
            const c = JSON.parse(bundle.complements || "[]");
            return `${c.length} complement${c.length !== 1 ? "s" : ""}`;
          } catch { return "—"; }
        })()}
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
            onClick={() => handleToggle(bundle.id, "complement")}
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
            onClick={() => handleDelete(bundle.id, "complement")}
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

  const totalCount = tieredBundles.length + volumeBundles.length + complementBundles.length;

  return (
    <Page
      title="Bundles"
      primaryAction={{
        content: "Create FBT bundle",
        onAction: () => navigate("/app/complement/new"),
      }}
      secondaryActions={[
        {
          content: "Create tiered combo",
          onAction: () => navigate("/app/tiers/new"),
        },
        {
          content: "Create volume discount",
          onAction: () => navigate("/app/volume/new"),
        },
      ]}
    >
      {hasNoBundles ? (
        emptyState
      ) : (
        <IndexTable
          condensed={!smUp}
          resourceName={{ singular: "bundle", plural: "bundles" }}
          itemCount={totalCount}
          selectedItemsCount={0}
          onSelectionChange={() => {}}
          headings={[
            { title: "Name" },
            { title: "Type" },
            { title: "Condition" },
            { title: "Details" },
            { title: "Status" },
            { title: "Actions" },
          ]}
          selectable={false}
        >
          {tieredRows}
          {volumeRows}
          {complementRows}
        </IndexTable>
      )}
    </Page>
  );
}
