/**
 * Concurrency-limited HTTP client for the NetSuite REST Records API and
 * custom RESTlets.
 *
 * Features:
 *  - Bearer token management via auth.ts (auto-refresh, single-retry on 401).
 *  - Concurrency semaphore (p-limit) honouring RATE_LIMITS.NETSUITE_MAX_CONCURRENT.
 *  - Automatic retry (via withRetry) for transient / rate-limit errors.
 *  - Structured logging for every request.
 */

import axios from "axios";
import pLimit from "p-limit";
import { query } from "../../db/client.js";
import { decrypt } from "../utils/crypto";
import { RATE_LIMITS } from "../utils/constants";
import { createServiceLogger } from "../services/common/logger";
import { withRetry } from "../services/common/retry";
import {
  NetSuiteError,
  NetSuiteAuthError,
  NetSuiteRateLimitError,
} from "../services/common/errors";
import { getAccessToken, clearTokenCache } from "./auth";

const log = createServiceLogger("netsuite-client");

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

async function loadConfig() {
  const result = await query(
    `SELECT * FROM netsuite_config WHERE is_active = true ORDER BY id LIMIT 1`,
  );

  if (result.rows.length === 0) {
    throw new NetSuiteError("No active NetSuite configuration found", "CONFIG_MISSING");
  }

  const row = result.rows[0];

  const privateKeyPem = decrypt(row.privateKeyEnc);

  const config = {
    id: row.id,
    accountId: row.accountId,
    clientId: row.clientId,
    clientSecretEnc: row.clientSecretEnc,
    privateKeyEnc: row.privateKeyEnc,
    certificateId: row.certificateId,
    restletUrls: row.restletUrls ?? {},
    scopes: row.scopes ?? ["rest_webservices", "restlets"],
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return { config, privateKeyPem };
}

// ---------------------------------------------------------------------------
// NetSuiteClient class
// ---------------------------------------------------------------------------

export class NetSuiteClient {
  constructor(config, privateKeyPem) {
    this.config = config;
    this.privateKeyPem = privateKeyPem;

    const normalisedAccount = config.accountId.replace(/_/g, "-").toLowerCase();
    this.baseUrl = `https://${normalisedAccount}.suitetalk.api.netsuite.com/services/rest/record/v1`;

    this.limiter = pLimit(RATE_LIMITS.NETSUITE_MAX_CONCURRENT);

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  // -----------------------------------------------------------------------
  // Token helper
  // -----------------------------------------------------------------------

  async authHeaders() {
    const token = await getAccessToken(this.config, this.privateKeyPem);
    return { Authorization: `Bearer ${token}` };
  }

  // -----------------------------------------------------------------------
  // Core request method
  // -----------------------------------------------------------------------

  /**
   * Execute an HTTP request through the concurrency limiter with automatic
   * retry and 401 token-refresh handling.
   */
  async request(
    axiosConfig,
    options = {},
    _isRetryOn401 = false,
  ) {
    return this.limiter(async () => {
      const mergedConfig = {
        ...axiosConfig,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        params: { ...axiosConfig.params, ...options.params },
        headers: {
          ...axiosConfig.headers,
          ...(await this.authHeaders()),
          ...options.headers,
        },
      };

      const execute = async () => {
        const startMs = Date.now();
        try {
          const response = await this.httpClient.request(mergedConfig);
          log.debug(
            {
              method: mergedConfig.method,
              url: mergedConfig.url,
              status: response.status,
              durationMs: Date.now() - startMs,
            },
            "NetSuite request completed",
          );
          return response.data;
        } catch (error) {
          if (!axios.isAxiosError(error)) throw error;

          const status = error.response?.status;
          const durationMs = Date.now() - startMs;

          // 429 - Rate limit
          if (status === 429) {
            const retryAfterHeader = error.response?.headers?.["retry-after"];
            const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 30;
            log.warn(
              { method: mergedConfig.method, url: mergedConfig.url, retryAfter, durationMs },
              "NetSuite rate limit hit",
            );
            throw new NetSuiteRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 30);
          }

          // 401 - Token might have expired; clear cache and retry once.
          if (status === 401 && !_isRetryOn401) {
            log.info(
              { accountId: this.config.accountId },
              "Received 401 - clearing token cache and retrying",
            );
            clearTokenCache(this.config.accountId);

            // Refresh auth headers and retry the request exactly once.
            mergedConfig.headers = {
              ...mergedConfig.headers,
              ...(await this.authHeaders()),
            };
            return this.request(axiosConfig, options, true);
          }

          // Other errors
          const body = error.response?.data;
          log.error(
            {
              method: mergedConfig.method,
              url: mergedConfig.url,
              status,
              body,
              durationMs,
            },
            "NetSuite request failed",
          );

          if (status === 401) {
            throw new NetSuiteAuthError(
              `Authentication failed: ${typeof body === "object" ? JSON.stringify(body) : body}`,
            );
          }

          throw new NetSuiteError(
            `NetSuite request failed (HTTP ${status ?? "unknown"}): ${
              typeof body === "object" ? JSON.stringify(body) : body ?? error.message
            }`,
            String(status ?? "UNKNOWN"),
            status ?? 500,
          );
        }
      };

      if (options.skipRetry) {
        return execute();
      }
      return withRetry(execute);
    });
  }

  // -----------------------------------------------------------------------
  // Public convenience methods
  // -----------------------------------------------------------------------

  /**
   * GET a REST Records API resource.
   *
   * @param path  Relative to the records base URL, e.g. `/inventoryItem/123`.
   */
  async get(path, options) {
    return this.request({ method: "GET", url: path }, options);
  }

  /**
   * POST (create) a REST Records API resource.
   */
  async post(
    path,
    data,
    options,
  ) {
    return this.request({ method: "POST", url: path, data }, options);
  }

  /**
   * PATCH (update) a REST Records API resource.
   */
  async patch(
    path,
    data,
    options,
  ) {
    return this.request({ method: "PATCH", url: path, data }, options);
  }

  /**
   * Invoke a custom RESTlet.
   *
   * RESTlets live on a different host than the REST Records API, so we build
   * the full URL from the account ID + script/deploy IDs.
   *
   * @param scriptId  The RESTlet script ID (e.g. `customscript_inv_search`).
   * @param deployId  The deployment ID (e.g. `customdeploy_inv_search`).
   * @param data      JSON body sent via POST.
   */
  async callRestlet(
    scriptId,
    deployId,
    data,
    options,
  ) {
    const normalisedAccount = this.config.accountId.replace(/_/g, "-").toLowerCase();
    const restletUrl =
      `https://${normalisedAccount}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`;

    return this.limiter(async () => {
      const execute = async () => {
        const startMs = Date.now();
        try {
          const response = await this.httpClient.request({
            method: "POST",
            url: restletUrl,
            params: {
              script: scriptId,
              deploy: deployId,
              ...options?.params,
            },
            data,
            timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              ...(await this.authHeaders()),
              ...options?.headers,
            },
            // Override baseURL so the full restletUrl is used as-is.
            baseURL: undefined,
          });

          log.debug(
            {
              scriptId,
              deployId,
              status: response.status,
              durationMs: Date.now() - startMs,
            },
            "RESTlet call completed",
          );
          return response.data;
        } catch (error) {
          if (!axios.isAxiosError(error)) throw error;

          const status = error.response?.status;
          const durationMs = Date.now() - startMs;

          if (status === 429) {
            const retryAfterHeader = error.response?.headers?.["retry-after"];
            const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 30;
            throw new NetSuiteRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 30);
          }

          if (status === 401) {
            clearTokenCache(this.config.accountId);
            throw new NetSuiteAuthError(
              `RESTlet auth failed (script=${scriptId}): ${error.response?.data ?? error.message}`,
            );
          }

          const body = error.response?.data;
          log.error(
            { scriptId, deployId, status, body, durationMs },
            "RESTlet call failed",
          );

          throw new NetSuiteError(
            `RESTlet call failed (HTTP ${status ?? "unknown"}): ${
              typeof body === "object" ? JSON.stringify(body) : body ?? error.message
            }`,
            String(status ?? "UNKNOWN"),
            status ?? 500,
          );
        }
      };

      if (options?.skipRetry) {
        return execute();
      }
      return withRetry(execute);
    });
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Underlying NetSuite account ID (useful for logging / cache keys). */
  get accountId() {
    return this.config.accountId;
  }

  /** The RESTlet URL configuration from the netsuite_config table. */
  get restletUrls() {
    return this.config.restletUrls;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully initialised NetSuiteClient.
 *
 * Loads configuration from the `netsuite_config` database table, decrypts
 * secrets, and returns a ready-to-use client instance.
 */
export async function createNetSuiteClient() {
  const { config, privateKeyPem } = await loadConfig();
  log.info({ accountId: config.accountId }, "NetSuite client initialised");
  return new NetSuiteClient(config, privateKeyPem);
}
