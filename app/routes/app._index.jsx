import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }) {
  await authenticate.admin(request);

  const logs = await prisma.orderSync.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return jsonResponse(logs);
}

export default function OrderLogsPage() {
  const logs = useLoaderData();

  return (
    <s-page title="Order Sync Dashboard" inlineSize="large">
      <s-section>
        <s-grid
  gridTemplateColumns="auto auto"
  gap="small"
  placeContent="space-between space-between"
> <s-grid-item>
          <s-heading variant="heading-md">
            Recent Order Sync Activity
          </s-heading>
 </s-grid-item>
           <s-grid-item>
          <s-badge tone="info">{logs.length} records</s-badge>
           </s-grid-item>
        </s-grid>
  <s-paragraph tone="info" color="base" padding="base">
    Displays the most recent order sync operations from NetSuite to Shopify.
  </s-paragraph>
        

        <s-divider style={{ margin: "16px 0" }}></s-divider>

        {logs.length === 0 ? (
          <s-text tone="subdued">No logs available.</s-text>
        ) : (
          <s-table>
             <s-table-header-row>
              
                <s-table-header>NetSuite Company</s-table-header>
                <s-table-header>NetSuite Order ID</s-table-header>
                <s-table-header>Shopify Order ID</s-table-header>
                <s-table-header>Error Message</s-table-header>
                <s-table-header>Action</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Updated At</s-table-header>
             
             </s-table-header-row>

            <s-table-body>
              {logs.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>
                    <s-text font-weight="medium">
                      {entry.netsuiteCompanyId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    {entry.netsuiteOrderId}
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued">
                      {entry.shopifyOrderId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued">
                      {entry.errorMessage || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge
                      tone={entry.action === "CREATE" ? "success" : "info"}
                    >
                      {entry.action}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge
                      tone={entry.status === "SUCCESS" ? "success" : "critical"}
                    >
                      {entry.status}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued" variant="body-sm">
                      {new Date(entry.updatedAt).toLocaleString()}
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