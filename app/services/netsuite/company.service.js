/**
 * Normalize Shopify Company ID.
 *
 * Accepted:
 *   7540474138
 *   "7540474138"
 *   "gid://shopify/Company/7540474138"
 *
 * Returns:
 *   "7540474138"
 */
function normalizeShopifyCompanyId(shopifyCompanyId) {
  if (!shopifyCompanyId) {
    throw new Error("Shopify Company ID is required");
  }

  const value = String(shopifyCompanyId).trim();

  if (value.startsWith("gid://shopify/Company/")) {
    return value.split("/").pop();
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Invalid Shopify Company ID: ${shopifyCompanyId}`
    );
  }

  return value;
}

/**
 * Convert numeric Shopify Company ID to GraphQL GID.
 */
function getShopifyCompanyGid(shopifyCompanyId) {
  return `gid://shopify/Company/${shopifyCompanyId}`;
}

/**
 * Wait for a specified amount of time.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Check whether the error is a Shopify 401 Unauthorized error.
 */
function isUnauthorizedError(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || error);

  return (
    message.includes("401") ||
    message.includes("Unauthorized") ||
    message.includes("networkStatusCode: 401") ||
    message.includes('"networkStatusCode":401')
  );
}

/**
 * Find Shopify Company directly from Shopify.
 *
 * Retries ONLY when Shopify returns 401 Unauthorized.
 *
 * Retry strategy:
 *
 * Attempt 1 → immediately
 * Attempt 2 → after 500ms
 * Attempt 3 → after 1000ms
 *
 * Other errors are NOT retried.
 *
 * No CompanyMapping database lookup.
 * No CompanyMapping database creation.
 *
 * Returns:
 * {
 *   netsuiteCompanyId,
 *   shopifyCompanyId,
 *   shopifyCompanyName,
 *   shopifyCompanyLocationId
 * }
 */
export async function findCompanyByShopifyId(
  admin,
  shopifyCompanyId
) {
  // ---------------------------------------------------------
  // 1. Normalize Company ID
  // ---------------------------------------------------------

  const shopifyCompanyIdNumeric =
    normalizeShopifyCompanyId(shopifyCompanyId);

  const shopifyCompanyIdGid =
    getShopifyCompanyGid(
      shopifyCompanyIdNumeric
    );

  console.log(
    "[COMPANY LOOKUP] Fetching directly from Shopify",
    {
      input: shopifyCompanyId,
      numericId: shopifyCompanyIdNumeric,
      gid: shopifyCompanyIdGid,
    }
  );

  // ---------------------------------------------------------
  // 2. Shopify GraphQL query
  // ---------------------------------------------------------

  const query = `
    query GetCompany($id: ID!) {
      company(id: $id) {
        id
        name

        metafield(
          namespace: "custom"
          key: "netsuite_internal_id"
        ) {
          value
        }

        locations(first: 1) {
          nodes {
            id
            name
          }
        }
      }
    }
  `;

  // ---------------------------------------------------------
  // 3. Retry configuration
  // ---------------------------------------------------------

  const MAX_ATTEMPTS = 3;

  const RETRY_DELAYS = [
    1000,
    2000,
    3000,
  ];

  let response = null;
  let lastError = null;

  // ---------------------------------------------------------
  // 4. Shopify request with 401 retry
  // ---------------------------------------------------------

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      /*
       * Wait before retrying.
       *
       * First attempt:
       *   0ms
       *
       * Second attempt:
       *   500ms
       *
       * Third attempt:
       *   1000ms
       */

      const delay = RETRY_DELAYS[attempt - 1];

      if (delay > 0) {
        console.log(
          `[COMPANY LOOKUP] Waiting ${delay}ms before retry ${attempt}/${MAX_ATTEMPTS}`
        );

        await sleep(delay);
      }

      console.log(
        `[COMPANY LOOKUP] Shopify request attempt ${attempt}/${MAX_ATTEMPTS}`,
        {
          companyId: shopifyCompanyIdNumeric,
          companyGid: shopifyCompanyIdGid,
        }
      );

      response = await admin.request(query, {
        variables: {
          id: shopifyCompanyIdGid,
        },
      });

      /*
       * -----------------------------------------------------
       * Important:
       *
       * @shopify/admin-api-client can return the 401 as
       * a response error instead of throwing it.
       *
       * Example:
       *
       * {
       *   errors: {
       *     networkStatusCode: 401,
       *     message: "GraphQL Client: Unauthorized"
       *   }
       * }
       * -----------------------------------------------------
       */

      const responseError = response?.errors;

      if (responseError) {
        const responseErrorText =
          JSON.stringify(responseError);

        const is401 =
          responseError?.networkStatusCode === 401 ||
          responseErrorText.includes(
            "networkStatusCode"
          ) &&
            responseErrorText.includes("401") ||
          responseErrorText.includes(
            "Unauthorized"
          );

        /*
         * ---------------------------------------------------
         * 401 → retry
         * ---------------------------------------------------
         */

        if (is401) {
          lastError = new Error(
            `Shopify Company API returned 401 Unauthorized`
          );

          console.warn(
            `[COMPANY LOOKUP] Shopify returned 401 on attempt ${attempt}/${MAX_ATTEMPTS}`,
            {
              companyId:
                shopifyCompanyIdNumeric,
              companyGid:
                shopifyCompanyIdGid,
            }
          );

          if (attempt < MAX_ATTEMPTS) {
            continue;
          }

          /*
           * All retry attempts failed.
           */
          throw lastError;
        }

        /*
         * ---------------------------------------------------
         * Non-401 GraphQL error
         *
         * Do NOT retry.
         * ---------------------------------------------------
         */

        console.error(
          "[SHOPIFY COMPANY GRAPHQL ERROR]",
          JSON.stringify(
            responseError,
            null,
            2
          )
        );

        throw new Error(
          `Shopify Company GraphQL request failed: ${JSON.stringify(
            responseError
          )}`
        );
      }

      /*
       * -----------------------------------------------------
       * Successful HTTP/GraphQL response
       * -----------------------------------------------------
       */

      console.log(
        `[COMPANY LOOKUP] Shopify request successful on attempt ${attempt}/${MAX_ATTEMPTS}`
      );

      break;
    } catch (error) {
      lastError = error;

      /*
       * -----------------------------------------------------
       * Check whether thrown error is 401.
       * -----------------------------------------------------
       */

      if (isUnauthorizedError(error)) {
        console.warn(
          `[COMPANY LOOKUP] Unauthorized error on attempt ${attempt}/${MAX_ATTEMPTS}`,
          {
            companyId:
              shopifyCompanyIdNumeric,
            companyGid:
              shopifyCompanyIdGid,
            message: error.message,
          }
        );

        if (attempt < MAX_ATTEMPTS) {
          continue;
        }

        /*
         * All retries exhausted.
         */

        console.error(
          "[SHOPIFY COMPANY REQUEST ERROR] All retry attempts failed",
          {
            shopifyCompanyId:
              shopifyCompanyIdNumeric,
            shopifyCompanyGid:
              shopifyCompanyIdGid,
            attempts: MAX_ATTEMPTS,
            message: error.message,
            stack: error.stack,
          }
        );

        throw new Error(
          `Shopify Company API request failed after ${MAX_ATTEMPTS} attempts: ${error.message}`
        );
      }

      /*
       * -----------------------------------------------------
       * Non-401 error.
       *
       * Do NOT retry.
       * -----------------------------------------------------
       */

      console.error(
        "[SHOPIFY COMPANY REQUEST ERROR]",
        {
          shopifyCompanyId:
            shopifyCompanyIdNumeric,
          shopifyCompanyGid:
            shopifyCompanyIdGid,
          message: error.message,
          stack: error.stack,
        }
      );

      throw new Error(
        `Shopify Company API request failed: ${error.message}`
      );
    }
  }

  // ---------------------------------------------------------
  // 5. Final response validation
  // ---------------------------------------------------------

  console.log(
    "[COMPANY RESPONSE]",
    JSON.stringify(response, null, 2)
  );

  if (response?.errors) {
    console.error(
      "[SHOPIFY COMPANY GRAPHQL ERROR]",
      JSON.stringify(
        response.errors,
        null,
        2
      )
    );

    throw new Error(
      `Shopify Company GraphQL request failed: ${JSON.stringify(
        response.errors
      )}`
    );
  }

  // ---------------------------------------------------------
  // 6. Validate Company
  // ---------------------------------------------------------

  const company =
    response?.data?.company;

  if (!company) {
    throw new Error(
      `Company not found in Shopify: ${shopifyCompanyIdGid}`
    );
  }

  console.log(
    "[SHOPIFY COMPANY FOUND]",
    {
      id: company.id,
      name: company.name,
    }
  );

  // ---------------------------------------------------------
  // 7. Get NetSuite Company ID
  // ---------------------------------------------------------

  const netsuiteCompanyId =
    company.metafield?.value?.trim();

  if (!netsuiteCompanyId) {
    throw new Error(
      `Company ${company.name} (${shopifyCompanyIdGid}) does not have custom.netsuite_internal_id`
    );
  }

  // ---------------------------------------------------------
  // 8. Get Company Location
  // ---------------------------------------------------------

  const location =
    company.locations?.nodes?.[0];

  if (!location?.id) {
    throw new Error(
      `Company ${company.name} (${shopifyCompanyIdGid}) does not have a Company Location`
    );
  }

  const shopifyCompanyLocationId =
    location.id;

  // ---------------------------------------------------------
  // 9. Return company information
  // ---------------------------------------------------------

  const result = {
    netsuiteCompanyId,

    // Numeric Shopify Company ID
    shopifyCompanyId:
      shopifyCompanyIdNumeric,

    shopifyCompanyName:
      company.name,

    // Keep Company Location GID unchanged
    shopifyCompanyLocationId,
  };

  console.log(
    "[COMPANY LOOKUP SUCCESS]",
    JSON.stringify(result, null, 2)
  );

  return result;
}