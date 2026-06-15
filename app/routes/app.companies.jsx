import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { useLoaderData } from "react-router";
import { useFetcher }
  from "react-router";
export async function loader() {
  const companies =
    await prisma.companyMapping.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

  return json({ companies });
}

export async function action() {
  const {
    sessionStorage,
  } = await import(
    "../shopify.server"
  );

  const {
    createAdminApiClient,
  } = await import(
    "@shopify/admin-api-client"
  );

  const {
    syncCompanies,
  } = await import(
    "../services/shopify/companySync.server"
  );

  const SHOP_DOMAIN =
    process.env.SHOP;

  const session =
    await sessionStorage.loadSession(
      `offline_${SHOP_DOMAIN}`
    );

  const admin =
    createAdminApiClient({
      storeDomain:
        SHOP_DOMAIN,

      apiVersion:
        "2025-07",

      accessToken:
        session.accessToken,
    });

  const result =
    await syncCompanies(admin);

  return json(result);
}

export default function CompaniesPage() {
  const { companies } = useLoaderData();
const fetcher = useFetcher();
return (
  <s-page
    title="Company Mappings"
    inlineSize="large"
  >
    <s-section>
      <s-grid
        gridTemplateColumns="1fr auto auto"
        gap="small"
        placeContent="space-between center"
      >
        <s-grid-item>
          <s-heading variant="heading-md">
            Shopify ↔ NetSuite Company Mappings
          </s-heading>
        </s-grid-item>

      <div
  style={{
    padding: "0.355rem 0.75rem",
    borderRadius: "8px",
    background: "#e8f2ff",
    fontWeight: "600",
    fontSize: "0.7rem",
    lineHeight:"normal",
    border: "1px solid #b8d3ff",
  }}
>
  {companies.length} Companies
</div>


        <s-grid-item>
          <fetcher.Form method="post">
            <s-button
              type="submit"
              variant="primary"
              disabled={
                fetcher.state !== "idle"
              }
            >
              {fetcher.state !== "idle"
                ? "Syncing..."
                : "Sync Companies"}
            </s-button>
          </fetcher.Form>
        </s-grid-item>
      </s-grid>

      <s-paragraph
        tone="info"
        padding="base"
      >
        Cached company mappings used during
        Shopify ↔ NetSuite order synchronization.
      </s-paragraph>

      {fetcher.data && (
        <s-banner tone="success">
          Sync completed successfully.

          {" "}
          Synced:
          {" "}
          {fetcher.data.synced}

          {" | "}

          Skipped:
          {" "}
          {fetcher.data.skipped}
        </s-banner>
      )}

      <s-divider
        style={{
          margin: "16px 0",
        }}
      />

      {companies.length === 0 ? (
        <s-text tone="subdued">
          No company mappings found.
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
              Details
            </s-table-header>

            <s-table-header>
              Created
            </s-table-header>
          </s-table-header-row>

          <s-table-body>
            {companies.map(
              (company) => (
                <s-table-row
                  key={company.id}
                >
                  <s-table-cell>
                    <s-text font-weight="medium">
                      {
                        company.shopifyCompanyName
                      }
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="info">
                      {
                        company.shopifyCompanyId
                      }
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="success">
                      {
                        company.netsuiteCompanyId
                      }
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued">
                      {company.shopifyCompanyLocationId ||
                        "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    <details>
                      <summary>
                        View
                      </summary>

                      <pre>
                        {JSON.stringify(
                          company,
                          null,
                          2
                        )}
                      </pre>
                    </details>
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
              )
            )}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  </s-page>
);
}