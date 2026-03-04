import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload as any;
  console.log(
    `Subscription update: ${subscription.app_subscription?.name} → ${subscription.app_subscription?.status}`,
  );

  return new Response();
};
