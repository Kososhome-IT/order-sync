import prisma from "../../db.server";
import { findCustomerById }
  from "../netsuite/customer.service";

export async function syncCompanies(
  admin
) {
  let cursor = null;

  let synced = 0;
  let skipped = 0;

  const query = `
    query GetCompanies($cursor: String) {
      companies(
        first: 250
        after: $cursor
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }

        nodes {
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
            }
          }
        }
      }
    }
  `;

  while (true) {
    const response =
      await admin.request(query, {
        variables: {
          cursor,
        },
      });

    const companies =
      response.data.companies.nodes;

    for (const company of companies) {
      const netsuiteCompanyId =
        company.metafield?.value;

      if (!netsuiteCompanyId) {
        skipped++;
        continue;
      }

      const customer =
        await findCustomerById(
          netsuiteCompanyId
        );

      if (!customer) {
        skipped++;
        continue;
      }

      await prisma.companyMapping.upsert({
        where: {
          netsuiteCompanyId,
        },

        update: {
          shopifyCompanyId:
            company.id
              .split("/")
              .pop(),

          shopifyCompanyName:
            company.name,

          shopifyCompanyLocationId:
            company.locations.nodes[0]?.id,
        },

        create: {
          netsuiteCompanyId,

          shopifyCompanyId:
            company.id
              .split("/")
              .pop(),

          shopifyCompanyName:
            company.name,

          shopifyCompanyLocationId:
            company.locations.nodes[0]?.id,
        },
      });

      synced++;
    }

    const pageInfo =
      response.data.companies.pageInfo;

    if (!pageInfo.hasNextPage) {
      break;
    }

    cursor = pageInfo.endCursor;
  }

  return {
    synced,
    skipped,
  };
}