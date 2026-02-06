

export const webhooks = {
  ORDERS_CREATE: {
    deliveryMethod: "http",
    callbackUrl: "/webhooks_v1_orders_create",
  },
  ORDERS_UPDATED: {
    deliveryMethod: "http",
    callbackUrl: "/webhooks_v1_orders_update",
  },
  ORDERS_CANCELLED: {
    deliveryMethod: "http",
    callbackUrl: "/webhooks_v1_orders_cancelled",
  },
};



// export async function registerOrderWebhooks(admin, appUrl) {
//   console.log("🔥 Registering order webhooks...");

//   const WEBHOOKS = [
//     { topic: "ORDERS_CREATE", path: "/webhooks_v1_orders_create" },
//   { topic: "ORDERS_UPDATED", path: "/webhooks_v1_orders_updated" },
//   { topic: "ORDERS_CANCELLED", path: "/webhooks_v1_orders_cancelled" },
//   ];

//   for (const hook of WEBHOOKS) {
//     console.log("➡️ Creating webhook:", hook.topic);

//     const res = await admin.graphql(`
//       mutation {
//         webhookSubscriptionCreate(
//           topic: ${hook.topic}
//           webhookSubscription: {
//             callbackUrl: "${appUrl}${hook.path}"
//             format: JSON
//           }
//         ) {
//           webhookSubscription { id }
//           userErrors { field message }
//         }
//       }
//     `);

//     console.log(JSON.stringify(res, null, 2));
//   }
// }
