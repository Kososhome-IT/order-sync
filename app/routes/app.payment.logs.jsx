import { useLoaderData, useNavigate } from "react-router";
import { useState } from "react";
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

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || 1);
  const search = url.searchParams.get("search") || "";
  const sortBy = url.searchParams.get("sortBy") || "createdAt";
  const sortOrder = url.searchParams.get("sortOrder") || "desc";
  const pageSize = 50;
  const where = {};

  if (search) {
    where.OR = [
      { authorizationId: { contains: search, mode: "insensitive" } },
      { shopifyOrderId: { contains: search, mode: "insensitive" } },
      { netsuiteOrderId: { contains: search, mode: "insensitive" } },
      { paymentReference: { contains: search, mode: "insensitive" } },
    ];
  }

  const allowedSortFields = {
    createdAt: "createdAt",
    authorizationId: "authorizationId",
    shopifyOrderId: "shopifyOrderId",
    netsuiteOrderId: "netsuiteOrderId",
    capturedAmount: "capturedAmount",
    paymentReference: "paymentReference",
    status: "status",
  };

  const orderBy = {
    [allowedSortFields[sortBy] || "createdAt"]:
      sortOrder === "asc" ? "asc" : "desc",
  };

  const totalCount = await prisma.paymentSync.count({ where });

  const logs = await prisma.paymentSync.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return jsonResponse({
    logs,
    page,
    search,
    sortBy,
    sortOrder,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  });
}

export default function PaymentSyncLogDashboard() {
  const {
    logs,
    page,
    totalPages,
    totalCount,
    search: loaderSearch,
    sortBy,
    sortOrder,
  } = useLoaderData();

  const navigate = useNavigate();
  const [search, setSearch] = useState(loaderSearch || "");

  const buildUrl = (newPage = 1, newSortBy = sortBy, newSortOrder = sortOrder) =>
    `?page=${newPage}&search=${encodeURIComponent(search)}&sortBy=${newSortBy}&sortOrder=${newSortOrder}`;

  return (
    <s-page title="Payment Sync Logs" inlineSize="large">
      <s-section>
        <s-grid
          gridTemplateColumns="auto auto"
          gap="small"
          placeContent="space-between space-between"
        >
          <s-grid-item>
            <s-heading variant="heading-md">Payment Sync Event Logs</s-heading>
          </s-grid-item>
          <s-grid-item>
            <s-badge tone="info">{totalCount} events</s-badge>
          </s-grid-item>
        </s-grid>

        <s-paragraph tone="info" padding="base">
          Detailed event-level logs for all Payment captured operations.
        </s-paragraph>

        <s-divider style={{ margin: "16px 0" }} />

        {logs.length === 0 ? (
          <s-text tone="subdued">
            {search ? "No payment sync logs match your search." : "No log events available."}
          </s-text>
        ) : (
          <s-table>
            <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr auto">
              <s-text-field
                label="Search payment logs"
                labelAccessibilityVisibility="exclusive"
                icon="search"
                placeholder="Search order ID, NetSuite ID, payment reference..."
                value={search}
                onInput={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(buildUrl());
                }}
              />

              <s-button
                icon="sort"
                variant="secondary"
                accessibilityLabel="Sort"
                commandFor="payment-sort-actions"
              />

              <s-popover id="payment-sort-actions">
                <s-stack gap="none">
                  <s-box padding="small">
                    <s-choice-list
                      label="Sort by"
                      name="sortBy"
                      value={sortBy}
                      onChange={(e) => {
                        const newSortBy = e.currentTarget.values;
                        navigate(buildUrl(1, newSortBy, sortOrder));
                      }}
                    >
                      <s-choice value="createdAt">Created At</s-choice>
                      <s-choice value="authorizationId">Shopify Order Name</s-choice>
                      <s-choice value="shopifyOrderId">Shopify Order ID</s-choice>
                      <s-choice value="netsuiteOrderId">NetSuite Order ID</s-choice>
                      <s-choice value="capturedAmount">Captured Amount</s-choice>
                      <s-choice value="paymentReference">Payment Reference</s-choice>
                      <s-choice value="status">Status</s-choice>
                    </s-choice-list>

                    <s-choice-list
                      label="Order"
                      name="sortOrder"
                      value={sortOrder}
                      onChange={(e) => {
                        const newSortOrder = e.currentTarget.values;
                        navigate(buildUrl(1, sortBy, newSortOrder));
                      }}
                    >
                      <s-choice value="desc">Descending</s-choice>
                      <s-choice value="asc">Ascending</s-choice>
                    </s-choice-list>
                  </s-box>
                </s-stack>
              </s-popover>
            </s-grid>

            <s-table-header-row>
              <s-table-header>Shopify Order Name</s-table-header>
              <s-table-header>Shopify Order Id</s-table-header>
              <s-table-header>NetSuite Order Id</s-table-header>
              <s-table-header>Captured Amount</s-table-header>
              <s-table-header>Payment Reference Id</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Created At</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {logs.map((log) => (
                <s-table-row key={log.id}>
                  <s-table-cell>
                    <s-text font-weight="medium">
                      {log.authorizationId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>{log.shopifyOrderId || "—"}</s-table-cell>

                  <s-table-cell>
                    <s-badge tone="info">{log.netsuiteOrderId || "—"}</s-badge>
                  </s-table-cell>

                  <s-table-cell>{log.capturedAmount ?? "—"}</s-table-cell>

                  <s-table-cell>{log.paymentReference || "—"}</s-table-cell>

                  <s-table-cell>
                    <s-badge tone={statusTone(log.status)}>
                      {log.status}
                    </s-badge>
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

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
            marginTop: "20px",
          }}
        >
          <s-button
            disabled={page <= 1}
            onClick={() => navigate(buildUrl(page - 1))}
          >
            Previous
          </s-button>

          <span>Page {page} of {totalPages}</span>

          <s-button
            disabled={page >= totalPages}
            onClick={() => navigate(buildUrl(page + 1))}
          >
            Next
          </s-button>
        </div>
      </s-section>
    </s-page>
  );
}

function statusTone(status) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RECEIVED") return "info";
  return "attention";
} 