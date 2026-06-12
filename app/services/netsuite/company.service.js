import prisma from "../../db.server";

export async function findCompanyByShopifyId(
  admin,
  shopifyCompanyId
) {
  // 1. Check mapping table
let shopifyCompanyId_GID = `gid://shopify/Company/${shopifyCompanyId}`;
  const existing =
    await prisma.companyMapping.findFirst({
      where: {
        shopifyCompanyId:
          String(shopifyCompanyId_GID),
      },
    });

  if (existing) {
    return existing;
  }

  // 2. Shopify fallback

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
          }
        }
      }
    }
  `;

  const response =
    await admin.request(query, {
      variables: {
       id: shopifyCompanyId,
      },
    });

    console.log(
  "COMPANY RESPONSE",
  JSON.stringify(response, null, 2)
);

  const company =
    response?.data?.company;

  if (!company) {
    throw new Error(
      `Company not found ${shopifyCompanyId_GID}`
    );
  }

  const netsuiteCompanyId =
    company.metafield?.value;

  if (!netsuiteCompanyId) {
        throw new Error(
        `Company ${company.name} does not have custom.netsuite_internal_id`
        );
  }

  const locationId =
    `gid://shopify/CompanyLocation/${company.locations.nodes[0]?.id}`;

    console.log("CREATE COMPANY MAPPING", {
  netsuiteCompanyId,
  shopifyCompanyId: String(shopifyCompanyId_GID),
  companyName: company.name,
  locationId,
});

try {
  const mapping =
    await prisma.companyMapping.create({
      data: {
        netsuiteCompanyId,
        shopifyCompanyId: String(shopifyCompanyId_GID),
        shopifyCompanyName: company.name,
        shopifyCompanyLocationId: locationId,
      },
    });

  return mapping;
} catch (error) {
  console.error(
    "COMPANY CREATE ERROR",
    error
  );

  throw error;
}

  return mapping;
}