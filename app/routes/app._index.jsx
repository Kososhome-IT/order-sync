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

  const orders = await prisma.orderSync.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return jsonResponse(orders);
}

export default function OrderSyncDashboard() {
  const orders = useLoaderData();

  return (
    <s-page title="Order Sync Dashboard" inlineSize="large">
      <s-section>
        <s-grid
          gridTemplateColumns="auto auto"
          gap="small"
          placeContent="space-between space-between"
        >
          <s-grid-item>
            <s-heading variant="heading-md">
              Order Synchronization Overview
            </s-heading>
          </s-grid-item>

          <s-grid-item>
            <s-badge tone="info">{orders.length} records</s-badge>
          </s-grid-item>
        </s-grid>

        <s-paragraph tone="info" padding="base">
          Displays high-level order synchronization status between Shopify and NetSuite.
        </s-paragraph>

        <s-divider style={{ margin: "16px 0" }} />

        {orders.length === 0 ? (
          <s-text tone="subdued">No order sync records available.</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Origin</s-table-header>
              <s-table-header>Last Synced From</s-table-header>
              <s-table-header>NetSuite Company</s-table-header>
              <s-table-header>NetSuite Order ID</s-table-header>
              <s-table-header>Shopify Order ID</s-table-header>
              <s-table-header>Action</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Updated At</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {orders.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>
                    <s-badge tone="info">
                      {entry.originSystem}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="warning">
                      {entry.lastSyncedFrom}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text font-weight="medium">
                      {entry.netsuiteCompanyId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    {entry.netsuiteOrderId || "—"}
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued">
                      {entry.shopifyOrderId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone={actionTone(entry.action)}>
                      {entry.action}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone={statusTone(entry.status)}>
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

/* -------------------------
   Badge helpers
-------------------------- */

function statusTone(status) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "critical";
  if (status === "PENDING") return "attention";
  if (status === "PARTIAL") return "warning";
  return "info";
}

function actionTone(action) {
  if (action === "CREATE") return "success";
  if (action === "UPDATE") return "info";
  if (action === "CANCEL") return "critical";
  return "info";
}
