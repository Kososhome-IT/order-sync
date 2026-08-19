import prisma from "../../db.server";

/**
 * Normalize Shopify Company ID to numeric format.
 *
 * Accepted:
 *   7540474138
 *   "7540474138"
 *   "gid://shopify/Company/7540474138"
 *
 * Always returns:
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
 * Convert numeric Shopify Company ID to Shopify GraphQL GID.
 */
function getShopifyCompanyGid(shopifyCompanyId) {
  return `gid://shopify/Company/${shopifyCompanyId}`;
}

/**
 * Find Shopify Company → NetSuite Company mapping.
 *
 * Database:
 *   shopifyCompanyId = numeric ID
 *
 * Shopify API:
 *   gid://shopify/Company/XXXXXXXX
 */
export async function findCompanyByShopifyId(
  admin,
  shopifyCompanyId
) {
  // ---------------------------------------------------------
  // 1. Normalize Shopify Company ID
  // ---------------------------------------------------------

  const shopifyCompanyIdNumeric =
    normalizeShopifyCompanyId(shopifyCompanyId);

  const shopifyCompanyIdGid =
    getShopifyCompanyGid(shopifyCompanyIdNumeric);

  console.log(
    "[COMPANY LOOKUP]",
    JSON.stringify(
      {
        input: shopifyCompanyId,
        numericId: shopifyCompanyIdNumeric,
        gid: shopifyCompanyIdGid,
      },
      null,
      2
    )
  );

  // ---------------------------------------------------------
  // 2. Check local CompanyMapping table
  // ---------------------------------------------------------

  const existing =
    await prisma.companyMapping.findFirst({
      where: {
        shopifyCompanyId:
          shopifyCompanyIdNumeric,
      },
    });

  if (existing) {
    console.log(
      "[COMPANY MAPPING] Found existing mapping:",
      JSON.stringify(existing, null, 2)
    );

    return existing;
  }

  console.log(
    "[COMPANY MAPPING] Mapping not found. Fetching from Shopify:",
    shopifyCompanyIdGid
  );

  // ---------------------------------------------------------
  // 3. Shopify Company GraphQL query
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

        locations(first: 10) {
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
        shopifyCompanyId: shopifyCompanyIdNumeric,
        shopifyCompanyGid: shopifyCompanyIdGid,
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
  // 4. Handle GraphQL errors separately
  // ---------------------------------------------------------

  if (response?.errors) {
    console.error(
      "[SHOPIFY COMPANY GRAPHQL ERROR]",
      JSON.stringify(response.errors, null, 2)
    );

    throw new Error(
      `Shopify Company GraphQL request failed: ${JSON.stringify(
        response.errors
      )}`
    );
  }

  // ---------------------------------------------------------
  // 5. Validate Company
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
    JSON.stringify(
      {
        id: company.id,
        name: company.name,
      },
      null,
      2
    )
  );

  // ---------------------------------------------------------
  // 6. Get NetSuite Company ID
  // ---------------------------------------------------------

  const netsuiteCompanyId =
    company.metafield?.value?.trim();

  if (!netsuiteCompanyId) {
    throw new Error(
      `Company ${company.name} (${shopifyCompanyIdGid}) does not have custom.netsuite_internal_id`
    );
  }

  // ---------------------------------------------------------
  // 7. Get Shopify Company Location
  //
  // Business rule:
  // One Company has one Company Location.
  // ---------------------------------------------------------

  const location =
    company.locations?.nodes?.[0];

  if (!location?.id) {
    throw new Error(
      `Company ${company.name} (${shopifyCompanyIdGid}) does not have a Company Location`
    );
  }

  const shopifyCompanyLocationIdGid =
    location.id;

  // Convert:
  // gid://shopify/CompanyLocation/5926060314
  //
  // To:
  // 5926060314

  const shopifyCompanyLocationId =
    shopifyCompanyLocationIdGid
      .split("/")
      .pop();

  if (
    !shopifyCompanyLocationId ||
    !/^\d+$/.test(
      shopifyCompanyLocationId
    )
  ) {
    throw new Error(
      `Invalid Shopify Company Location ID: ${shopifyCompanyLocationIdGid}`
    );
  }

  console.log(
    "[COMPANY DATA FROM SHOPIFY]",
    JSON.stringify(
      {
        shopifyCompanyId:
          shopifyCompanyIdNumeric,
        shopifyCompanyLocationId,
        shopifyCompanyLocationGid:
          shopifyCompanyLocationIdGid,
        companyName: company.name,
        netsuiteCompanyId,
      },
      null,
      2
    )
  );

  // ---------------------------------------------------------
  // 8. Check NetSuite Company mapping
  // ---------------------------------------------------------

  const existingByNs =
    await prisma.companyMapping.findUnique({
      where: {
        netsuiteCompanyId,
      },
    });

  if (existingByNs) {
    // Make sure this NetSuite Company belongs
    // to the same Shopify Company.

    if (
      existingByNs.shopifyCompanyId !==
      shopifyCompanyIdNumeric
    ) {
      console.error(
        "[COMPANY MAPPING CONFLICT]",
        JSON.stringify(
          {
            netsuiteCompanyId,
            requestedShopifyCompanyId:
              shopifyCompanyIdNumeric,
            existingShopifyCompanyId:
              existingByNs.shopifyCompanyId,
            existingMapping:
              existingByNs,
          },
          null,
          2
        )
      );

      throw new Error(
        `NetSuite Company ${netsuiteCompanyId} is already mapped to another Shopify Company: ${existingByNs.shopifyCompanyId}`
      );
    }

    console.log(
      "[COMPANY MAPPING] Found existing mapping by NetSuite Company ID:",
      JSON.stringify(existingByNs, null, 2)
    );

    return existingByNs;
  }

  // ---------------------------------------------------------
  // 9. Create new CompanyMapping
  // ---------------------------------------------------------

  try {
    const mapping =
      await prisma.companyMapping.create({
        data: {
          netsuiteCompanyId,

          // IMPORTANT:
          // Store NUMERIC Shopify Company ID only.
          shopifyCompanyId:
            shopifyCompanyIdNumeric,

          shopifyCompanyName:
            company.name,

          // IMPORTANT:
          // Store NUMERIC Shopify Company Location ID only.
          shopifyCompanyLocationId:
            shopifyCompanyLocationId,
        },
      });

    console.log(
      "[COMPANY MAPPING] Created successfully:",
      JSON.stringify(mapping, null, 2)
    );

    return mapping;
  } catch (error) {
    // -------------------------------------------------------
    // 10. Handle Prisma unique constraint race condition
    // -------------------------------------------------------

    if (error?.code === "P2002") {
      console.warn(
        "[COMPANY MAPPING] Mapping was created by another request. Re-checking database."
      );

      const existingAfterConflict =
        await prisma.companyMapping.findFirst({
          where: {
            shopifyCompanyId:
              shopifyCompanyIdNumeric,
          },
        });

      if (existingAfterConflict) {
        return existingAfterConflict;
      }

      const existingNsAfterConflict =
        await prisma.companyMapping.findUnique({
          where: {
            netsuiteCompanyId,
          },
        });

      if (existingNsAfterConflict) {
        if (
          existingNsAfterConflict.shopifyCompanyId !==
          shopifyCompanyIdNumeric
        ) {
          throw new Error(
            `NetSuite Company ${netsuiteCompanyId} is already mapped to another Shopify Company: ${existingNsAfterConflict.shopifyCompanyId}`
          );
        }

        return existingNsAfterConflict;
      }
    }

    console.error(
      "[COMPANY MAPPING CREATE ERROR]",
      {
        message: error.message,
        code: error.code,
        meta: error.meta,
      }
    );

    throw error;
  }
}