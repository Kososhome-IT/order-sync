import prisma from "../../db.server";

const COMPANY_QUERY = `
query GetCompanies($cursor: String) {
  companies(first: 100, after: $cursor) {
    nodes {
      id
      name

      metafield(
        namespace: "custom"
        key: "netsuite_internal_id"
      ) {
        value
      }

      locations(first: 20) {
        nodes {
          id
          name
        }
      }
    }

    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export async function findCompanyByNetSuiteId(
  admin,
  netsuiteCompanyId
) {

  // STEP 1
  // CHECK LOCAL CACHE

  const existing =
    await prisma.companyMapping.findUnique({
      where: {
        netsuiteCompanyId:
          String(netsuiteCompanyId),
      },
    });

  if (existing) {
    return {
      companyId:
        existing.shopifyCompanyId,

      companyName:
        existing.shopifyCompanyName,

      companyLocationId:
        existing.shopifyCompanyLocationId,
    };
  }

  // STEP 2
  // SEARCH SHOPIFY

  let cursor = null;

  do {
    const response =
      await admin.request(
        COMPANY_QUERY,
        {
          variables: {
            cursor,
          },
        }
      );

    const companies =
      response?.data?.companies?.nodes || [];

    const matchedCompany =
      companies.find(
        company =>
          company?.metafield?.value ===
          String(netsuiteCompanyId)
      );

    if (matchedCompany) {

      const companyLocationId =
        matchedCompany.locations
          ?.nodes?.[0]?.id;

      if (!companyLocationId) {
        throw new Error(
          `No location found for company ${matchedCompany.name}`
        );
      }

      // STEP 3
      // SAVE CACHE

      await prisma.companyMapping.create({
        data: {
          netsuiteCompanyId:
            String(netsuiteCompanyId),

          shopifyCompanyId:
            matchedCompany.id,

          shopifyCompanyName:
            matchedCompany.name,

          shopifyCompanyLocationId:
            companyLocationId,
        },
      });

      return {
        companyId:
          matchedCompany.id,

        companyName:
          matchedCompany.name,

        companyLocationId,
      };
    }

    cursor =
      response?.data?.companies
        ?.pageInfo?.endCursor;

  } while (
    response?.data?.companies
      ?.pageInfo?.hasNextPage
  );

  throw new Error(
    `Company not found for NetSuite ID ${netsuiteCompanyId}`
  );
}