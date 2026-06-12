import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { useLoaderData } from "react-router";

export async function loader() {
  const companies =
    await prisma.companyMapping.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

  return json({ companies });
}



export default function CompaniesPage() {
  const { companies } = useLoaderData();

  return (
    <s-page title="Company Mappings" inlineSize="large">
  <s-section>
    <s-grid
      gridTemplateColumns="auto auto"
      gap="small"
      placeContent="space-between space-between"
    >
      <s-grid-item>
        <s-heading variant="heading-md">
          Shopify ↔ NetSuite Company Mappings
        </s-heading>
      </s-grid-item>

      <s-grid-item>
        <s-badge tone="info">
          {companies.length} companies
        </s-badge>
      </s-grid-item>
    </s-grid>

    <s-paragraph tone="info" padding="base">
      Cached company mappings used during order synchronization.
    </s-paragraph>

    <s-divider style={{ margin: "16px 0" }} />

    {companies.length === 0 ? (
      <s-text tone="subdued">
        No companies found.
      </s-text>
    ) : (
      <s-table>
        <s-table-header-row>
          <s-table-header>
            Company Name
          </s-table-header>

          <s-table-header>
            Shopify Company
          </s-table-header>

          <s-table-header>
            NetSuite Company
          </s-table-header>

          <s-table-header>
            Location
          </s-table-header>

          <s-table-header>
            Created
          </s-table-header>
        </s-table-header-row>

        <s-table-body>
          {companies.map((company) => (
            <s-table-row key={company.id}>
              <s-table-cell>
                <s-text font-weight="medium">
                  {company.shopifyCompanyName}
                </s-text>
              </s-table-cell>

              <s-table-cell>
                <s-badge tone="info">
                  {company.shopifyCompanyId}
                </s-badge>
              </s-table-cell>

              <s-table-cell>
                <s-badge tone="success">
                  {company.netsuiteCompanyId}
                </s-badge>
              </s-table-cell>

              <s-table-cell>
                <s-text tone="subdued">
                  {company.shopifyCompanyLocationId}
                </s-text>
              </s-table-cell>

              <s-table-cell>
                <s-text
                  tone="subdued"
                  variant="body-sm"
                >
                  {new Date(
                    company.createdAt
                  ).toLocaleString()}
                </s-text>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    )}
  </s-section>
</s-page>
  );
}