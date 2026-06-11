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

  const logs = await prisma.orderSyncLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      orderSync: true, // for Shopify / NetSuite order IDs
    },
  });

  return jsonResponse(logs);
}

export default function OrderSyncLogDashboard() {
  const logs = useLoaderData();

  return (
    <s-page title="Order Sync Logs" inlineSize="large">
      <s-section>
        <s-grid
          gridTemplateColumns="auto auto"
          gap="small"
          placeContent="space-between space-between"
        >
          <s-grid-item>
            <s-heading variant="heading-md">
              Order Sync Event Logs
            </s-heading>
          </s-grid-item>

          <s-grid-item>
            <s-badge tone="info">{logs.length} events</s-badge>
          </s-grid-item>
        </s-grid>

        <s-paragraph tone="info" padding="base">
          Detailed event-level logs for all Shopify ↔ NetSuite order sync operations.
        </s-paragraph>

        <s-divider style={{ margin: "16px 0" }} />

        {logs.length === 0 ? (
          <s-text tone="subdued">No log events available.</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Shopify Order</s-table-header>
              <s-table-header>NetSuite Order</s-table-header>
              <s-table-header>Source</s-table-header>
              <s-table-header>Direction</s-table-header>
              <s-table-header>Event</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Message</s-table-header>
              <s-table-header>Details</s-table-header>
              <s-table-header>Created At</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {logs.map((log) => (
                <s-table-row key={log.id}>
                  <s-table-cell>
                    <s-text font-weight="medium">
                      {log.orderSync?.shopifyOrderId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>
                    {log.orderSync?.netsuiteOrderId || "—"}
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="info">
                      {log.sourceSystem}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="warning">
                      {log.direction}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="info">
                      {log.eventType}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone={statusTone(log.status)}>
                      {log.status}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued">
                      {log.message || "—"}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
  <details>
    <summary>View</summary>

    <pre>
      {JSON.stringify(
        {
          requestPayload: log.requestPayload,
          responsePayload: log.responsePayload,
          errorPayload: log.errorPayload,
        },
        null,
        2
      )}
    </pre>
  </details>
</s-table-cell>

                  <s-table-cell>
                    <s-text tone="subdued" variant="body-sm">
                      {new Date(log.createdAt).toLocaleString()}
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
   Helpers
-------------------------- */

function statusTone(status) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RECEIVED") return "info";
  return "attention";
}
