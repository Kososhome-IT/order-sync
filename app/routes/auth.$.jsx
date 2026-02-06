import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
// import { registerOrderWebhooks } from "../utils/registerOrderWebhooks";

// export const loader = async ({ request }) => {
//  const { admin } = await authenticate.admin(request);
//    await registerOrderWebhooks(
//     admin,
//     process.env.SHOPIFY_APP_URL
//   );
//   return null;
// };

// export const headers = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };


export const loader = async ({ request }) => {
  console.log("🔥 AUTH ROUTE HIT:", request.url);

  const { admin } = await authenticate.admin(request);
  console.log("🔥 ADMIN CLIENT READY");

  // await registerOrderWebhooks(
  //   admin,
  //   process.env.SHOPIFY_APP_URL
  // );

  console.log("🔥 registerOrderWebhooks CALLED");

  return null;
};
