import prisma from "../../db.server";

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
 * Find Shopify Company directly from Shopify.
 *
 * No CompanyMapping database lookup.
 * No CompanyMapping database creation.
 *
 * Shopify Company:
 *   gid://shopify/Company/XXXXXXXX
 *
 * Returns:
 *   {
 *     netsuiteCompanyId,
 *     shopifyCompanyId,
 *     shopifyCompanyName,
 *     shopifyCompanyLocationId
 *   }
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

  let response;

  try {
    response = await admin.request(query, {
      variables: {
        id: shopifyCompanyIdGid,
      },
    });
  } catch (error) {
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

  console.log(
    "[COMPANY RESPONSE]",
    JSON.stringify(response, null, 2)
  );

  // ---------------------------------------------------------
  // 3. Handle GraphQL errors
  // ---------------------------------------------------------

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
  // 4. Validate Company
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
  // 5. Get NetSuite Company ID
  // ---------------------------------------------------------

  const netsuiteCompanyId =
    company.metafield?.value?.trim();

  if (!netsuiteCompanyId) {
    throw new Error(
      `Company ${company.name} (${shopifyCompanyIdGid}) does not have custom.netsuite_internal_id`
    );
  }

  // ---------------------------------------------------------
  // 6. Get Company Location
  //
  // Keep Location ID exactly as Shopify returns it.
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
  // 7. Return company information
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