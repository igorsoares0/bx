import db from "../db.server";

type BundleType = "tiered" | "volume" | "complement";

type BundleDiscountMeta = {
  bundleType: BundleType;
  bundleId: number;
  bundleName: string;
  discountId: string;
};

export type TrustedDiscountCatalog = {
  bundleByDiscountId: Map<string, BundleDiscountMeta>;
  bundleByTitle: Map<string, BundleDiscountMeta>;
};

async function getKnownBundleDiscounts(shopId: string): Promise<BundleDiscountMeta[]> {
  const [tiered, volume, complement] = await Promise.all([
    db.tieredBundle.findMany({
      where: { shopId, discountId: { not: null } },
      select: { id: true, name: true, discountId: true },
    }),
    db.volumeBundle.findMany({
      where: { shopId, discountId: { not: null } },
      select: { id: true, name: true, discountId: true },
    }),
    db.complementBundle.findMany({
      where: { shopId, discountId: { not: null } },
      select: { id: true, name: true, discountId: true },
    }),
  ]);

  return [
    ...tiered.map((b) => ({
      bundleType: "tiered" as const,
      bundleId: b.id,
      bundleName: b.name,
      discountId: b.discountId!,
    })),
    ...volume.map((b) => ({
      bundleType: "volume" as const,
      bundleId: b.id,
      bundleName: b.name,
      discountId: b.discountId!,
    })),
    ...complement.map((b) => ({
      bundleType: "complement" as const,
      bundleId: b.id,
      bundleName: b.name,
      discountId: b.discountId!,
    })),
  ];
}

export async function buildTrustedDiscountCatalog(
  admin: any,
  shopId: string,
): Promise<TrustedDiscountCatalog> {
  const bundles = await getKnownBundleDiscounts(shopId);
  const bundleByDiscountId = new Map<string, BundleDiscountMeta>(
    bundles.map((bundle) => [bundle.discountId, bundle]),
  );
  const bundleByTitle = new Map<string, BundleDiscountMeta>();

  if (bundleByDiscountId.size === 0) {
    return { bundleByDiscountId, bundleByTitle };
  }

  try {
    for (const knownDiscountId of bundleByDiscountId.keys()) {
      const response = await admin.graphql(
        `#graphql
          query getKnownDiscount($id: ID!) {
            discountNode(id: $id) {
              discount {
                ... on DiscountAutomaticApp {
                  discountId
                  title
                }
              }
            }
          }`,
        { variables: { id: knownDiscountId } },
      );

      const data = await response.json();
      const discount = data?.data?.discountNode?.discount;
      const discountId = discount?.discountId;
      const title = discount?.title;
      if (!discountId || !title) continue;

      const bundle = bundleByDiscountId.get(discountId);
      if (!bundle) continue;
      if (!bundleByTitle.has(title)) {
        bundleByTitle.set(title, bundle);
      }
    }
  } catch (e) {
    console.error(`Failed to build trusted discount catalog for ${shopId}:`, e);
  }

  return { bundleByDiscountId, bundleByTitle };
}

function getLineNetRevenueCents(lineItem: any): number {
  const unitPrice = Number.parseFloat(String(lineItem?.price ?? "0"));
  const quantity = Number(lineItem?.quantity ?? 0);
  const totalDiscount = Number.parseFloat(String(lineItem?.total_discount ?? "0"));

  const lineTotal = Number.isFinite(unitPrice) && Number.isFinite(quantity)
    ? Math.round(unitPrice * 100 * quantity)
    : 0;
  const lineDiscount = Number.isFinite(totalDiscount) ? Math.round(totalDiscount * 100) : 0;

  return Math.max(0, lineTotal - lineDiscount);
}

function findTrustedBundleForLineItem(
  lineItem: any,
  discountApplications: any[],
  catalog: TrustedDiscountCatalog,
): BundleDiscountMeta | null {
  const allocations = lineItem?.discount_allocations || [];
  for (const allocation of allocations) {
    const index = Number(allocation?.discount_application_index);
    if (!Number.isInteger(index) || index < 0 || index >= discountApplications.length) {
      continue;
    }

    const application = discountApplications[index];
    const appType = String(application?.type || "").toLowerCase();
    if (appType && appType !== "automatic") continue;

    const appDiscountId =
      (typeof application?.admin_graphql_api_id === "string" && application.admin_graphql_api_id) ||
      (typeof application?.discount_id === "string" && application.discount_id) ||
      null;

    if (appDiscountId) {
      const bundleById = catalog.bundleByDiscountId.get(appDiscountId);
      if (bundleById) return bundleById;
    }

    const appTitle = typeof application?.title === "string" ? application.title : null;
    if (appTitle) {
      const bundleByTitle = catalog.bundleByTitle.get(appTitle);
      if (bundleByTitle) return bundleByTitle;
    }
  }

  return null;
}

export function calculateBundleRevenueFromOrderPayload(
  order: any,
  catalog: TrustedDiscountCatalog,
): { bundleRevenue: number; bundleType: string | null; bundleId: number | null } {
  const discountApplications = order?.discount_applications || [];
  const lineItems = order?.line_items || [];

  let bundleRevenue = 0;
  let bundleType: string | null = null;
  let bundleId: number | null = null;

  for (const lineItem of lineItems) {
    const trustedBundle = findTrustedBundleForLineItem(
      lineItem,
      discountApplications,
      catalog,
    );
    if (!trustedBundle) continue;

    bundleRevenue += getLineNetRevenueCents(lineItem);
    if (!bundleType) {
      bundleType = trustedBundle.bundleType;
      bundleId = trustedBundle.bundleId;
    }
  }

  return { bundleRevenue, bundleType, bundleId };
}

export async function getTrustedOrderLineItemIds(
  admin: any,
  orderId: string,
  catalog: TrustedDiscountCatalog,
): Promise<Set<string>> {
  const trustedLineItemIds = new Set<string>();

  if (catalog.bundleByTitle.size === 0) {
    return trustedLineItemIds;
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query getOrderLineDiscounts($id: ID!) {
          order(id: $id) {
            lineItems(first: 250) {
              nodes {
                id
                discountAllocations {
                  discountApplication {
                    __typename
                    ... on AutomaticDiscountApplication {
                      title
                    }
                  }
                }
              }
            }
          }
        }`,
      { variables: { id: orderId } },
    );

    const data = await response.json();
    const lines = data?.data?.order?.lineItems?.nodes || [];

    for (const line of lines) {
      const allocations = line?.discountAllocations || [];
      const hasTrustedDiscount = allocations.some((allocation: any) => {
        const application = allocation?.discountApplication;
        const title = application?.title;
        return typeof title === "string" && catalog.bundleByTitle.has(title);
      });

      if (hasTrustedDiscount && typeof line?.id === "string") {
        trustedLineItemIds.add(line.id);
      }
    }
  } catch (e) {
    console.error(`Failed to resolve trusted order lines for ${orderId}:`, e);
  }

  return trustedLineItemIds;
}
