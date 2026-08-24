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

export async function findCompanyByShopifyId(
  admin,
  shopifyCompanyId
) {
  const shopifyCompanyIdNumeric =
    normalizeShopifyCompanyId(shopifyCompanyId);

  const shopifyCompanyIdGid =
    getShopifyCompanyGid(shopifyCompanyIdNumeric);

  console.log(
    "[COMPANY LOOKUP] Fetching directly from Shopify",
    {
      input: shopifyCompanyId,
      numericId: shopifyCompanyIdNumeric,
      gid: shopifyCompanyIdGid,
    }
  );

  const query = `#graphql
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

  try {
    console.log(
      "[COMPANY LOOKUP] Shopify GraphQL request",
      {
        companyGid: shopifyCompanyIdGid,
      }
    );

    const response = await admin.graphql(query, {
      variables: {
        id: shopifyCompanyIdGid,
      },
    });

    const result = await response.json();

    console.log(
      "[COMPANY LOOKUP] Shopify response",
      JSON.stringify(result, null, 2)
    );

    if (!response.ok) {
      throw new Error(
        `Shopify Company API returned HTTP ${response.status}`
      );
    }

    if (result.errors?.length) {
      throw new Error(
        `Shopify Company GraphQL request failed: ${JSON.stringify(
          result.errors
        )}`
      );
    }

    const company = result.data?.company;

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

    const netsuiteCompanyId =
      company.metafield?.value?.trim();

    if (!netsuiteCompanyId) {
      throw new Error(
        `Company ${company.name} (${shopifyCompanyIdGid}) does not have custom.netsuite_internal_id`
      );
    }

    const location =
      company.locations?.nodes?.[0];

    if (!location?.id) {
      throw new Error(
        `Company ${company.name} (${shopifyCompanyIdGid}) does not have a Company Location`
      );
    }

    return {
      netsuiteCompanyId,
      shopifyCompanyId:
        shopifyCompanyIdNumeric,
      shopifyCompanyName:
        company.name,
      shopifyCompanyLocationId:
        location.id,
    };
  } catch (error) {
    console.error(
      "[SHOPIFY COMPANY LOOKUP FAILED]",
      {
        companyId: shopifyCompanyIdNumeric,
        companyGid: shopifyCompanyIdGid,
        message: error.message,
        stack: error.stack,
      }
    );

    throw error;
  }
}