/**
 * NetSuite OAuth 2.0 Machine-to-Machine (Client Credentials) token acquisition.
 *
 * Uses ES256 JWT assertions signed with the app's private key.
 * Tokens are cached in-process and proactively refreshed at 80 % of their
 * lifetime so callers never block on an expired token.
 */

import { SignJWT, importPKCS8 } from "jose";
import axios from "axios";
import { createServiceLogger } from "../services/common/logger";
import { NetSuiteAuthError } from "../services/common/errors";

const log = createServiceLogger("netsuite-auth");

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

/** In-memory cache keyed by NetSuite account ID. */
const tokenCache = new Map();

/** In-flight token requests keyed by account ID (de-duplication). */
const inflightRequests = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REFRESH_FACTOR = 0.8;
const JWT_LIFETIME_SECS = 300; // 5 minutes

function tokenEndpoint(accountId) {
  // NetSuite account IDs use underscores in DNS (e.g. "123456_SB1")
  const normalisedAccount = accountId.replace(/_/g, "-").toLowerCase();
  return `https://${normalisedAccount}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

async function buildJwt(config, privateKeyPem) {
  const aud = tokenEndpoint(config.accountId);
  const now = Math.floor(Date.now() / 1000);

  const privateKey = await importPKCS8(privateKeyPem, "ES256");

  const jwt = await new SignJWT({
    scope: config.scopes.join(" ") || "rest_webservices restlets",
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "JWT",
      kid: config.certificateId,
    })
    .setIssuer(config.clientId)
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECS)
    .sign(privateKey);

  return jwt;
}

async function requestToken(
  config,
  privateKeyPem,
) {
  const url = tokenEndpoint(config.accountId);
  const assertion = await buildJwt(config, privateKeyPem);

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });

  try {
    const response = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    });

    const data = response.data;

    if (!data.access_token) {
      throw new NetSuiteAuthError("Token response missing access_token");
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const body = error.response?.data;
      log.error(
        { status, body, accountId: config.accountId },
        "Failed to acquire NetSuite access token",
      );
      throw new NetSuiteAuthError(
        `Token request failed (HTTP ${status ?? "unknown"}): ${
          typeof body === "object" ? JSON.stringify(body) : body
        }`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a valid Bearer access token for the given NetSuite configuration.
 *
 * If a cached token exists and has not reached 80 % of its lifetime, the
 * cached value is returned immediately.  Otherwise a fresh token is obtained,
 * cached, and returned.
 *
 * Concurrent callers for the same account share a single in-flight request
 * to avoid thundering-herd issues.
 *
 * @param config       Full NetSuite configuration (must include decrypted private key PEM).
 * @param privateKeyPem  Decrypted PEM-encoded ES256 private key.
 */
export async function getAccessToken(
  config,
  privateKeyPem,
) {
  const cached = tokenCache.get(config.accountId);
  if (cached && Date.now() < cached.refreshAt) {
    return cached.accessToken;
  }

  // De-duplicate concurrent requests for the same account.
  const existing = inflightRequests.get(config.accountId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      log.debug({ accountId: config.accountId }, "Acquiring new access token");
      const { accessToken, expiresIn } = await requestToken(config, privateKeyPem);

      const now = Date.now();
      tokenCache.set(config.accountId, {
        accessToken,
        refreshAt: now + expiresIn * 1000 * REFRESH_FACTOR,
        expiresAt: now + expiresIn * 1000,
      });

      log.info(
        { accountId: config.accountId, expiresIn },
        "Access token acquired and cached",
      );
      return accessToken;
    } finally {
      inflightRequests.delete(config.accountId);
    }
  })();

  inflightRequests.set(config.accountId, promise);
  return promise;
}

/**
 * Evict the cached token for a given account. Useful after receiving a 401
 * so the next call forces a fresh token exchange.
 */
export function clearTokenCache(accountId) {
  tokenCache.delete(accountId);
  log.debug({ accountId }, "Token cache cleared");
}
