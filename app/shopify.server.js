import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {})
});

export default shopify;

export async function getAdminClient(shopDomain) {

  
  const session =
    await shopify.sessionStorage.loadSession(
      `offline_${shopDomain}`
    );

  if (!session) {
    throw new Error(
      `Shop ${shopDomain} offline session not found`
    );
  }
console.log("[shopify.server.js]")
  console.log("[SHOPIFY OFFLINE SESSION]", {
    shop: session.shop,
    isOnline: session.isOnline,
    hasAccessToken: Boolean(session.accessToken),
    hasRefreshToken: Boolean(session.refreshToken),
    expires: session.expires || null,
    refreshTokenExpires:
      session.refreshTokenExpires || null,
    isExpired:
      typeof session.isExpired === "function"
        ? session.isExpired()
        : null,
    isActive:
      typeof session.isActive === "function"
        ? session.isActive()
        : null,
    scope: session.scope,
  });

  if (!session.accessToken) {
    throw new Error(
      `Shop ${shopDomain} has no Admin API access token`
    );
  }

  return createAdminApiClient({
    storeDomain: shopDomain,
    apiVersion:ApiVersion.July26,
    accessToken: session.accessToken,
  });
}

export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
