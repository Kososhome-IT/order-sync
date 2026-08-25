import { useLoaderData } from "react-router";
import { useNavigate } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { useState } from "react";
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";

  const page = Number(url.searchParams.get("page") || 1);

const sortBy = url.searchParams.get("sortBy") || "updatedAt";
const sortOrder = url.searchParams.get("sortOrder") || "desc";

  const pageSize = 30;
  const where = {};

  if (search) {
    where.OR = [
      {
        shopifyOrderName: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        shopifyOrderId: {
          contains: search,
        },
      },
      {
        netsuiteOrderId: {
          contains: search,
        },
      },
      {
        netsuiteCompanyId: {
          contains: search,
        },
      },
    ];
  }

  const totalCount = await prisma.orderSync.count({
    where,
  });

 const allowedSortFields = {
  updatedAt: "updatedAt",
  shopifyOrderName: "shopifyOrderName",
  netsuiteOrderId: "netsuiteOrderId",
  paymentStatus: "paymentCapturedAt",
};

const orders = await prisma.orderSync.findMany({
  where,
  orderBy: {
    [allowedSortFields[sortBy] || "updatedAt"]: sortOrder === "asc" ? "asc" : "desc",
  },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

 return jsonResponse({
  orders,
  page,
  search,
  sortBy,
  sortOrder,
  totalCount,
  totalPages: Math.ceil(totalCount / pageSize),
});
}

export default function OrderSyncDashboard() {
  const {
  orders,
  page,
  totalPages,
  search: loaderSearch,
  sortBy,
  sortOrder,
} = useLoaderData();
  const navigate = useNavigate();
  const [selectedPayload, setSelectedPayload] = useState(null);
  const [toast, setToast] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
  const [search, setSearch] = useState(loaderSearch || "");
  const showToast = (message, isError = false) => {
  shopify.toast.show(message, {
    duration: 5000,
    isError,
  });
};
const retryOrder = async (orderSyncId) => {
  setRetryingId(orderSyncId);

  try {
    const response = await fetch("/netsuite_create_order/retry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderSyncId,
      }),
    });

    const result = await response.json();

    if (result.success) {
      shopify.toast.show("Retry started successfully", {
        duration: 5000,
      });

      setTimeout(() => {
        window.location.reload();
      }, 5000);
    } else {
      shopify.toast.show(result.error || "Retry failed", {
        duration: 5000,
        isError: true,
      });
    }
  } catch (error) {
    shopify.toast.show(error.message || "Something went wrong", {
      duration: 5000,
      isError: true,
    });
  } finally {
    setRetryingId(null);
  }
};
  return (
    <s-page title="Order Sync Dashboard" inlineSize="large">
      <s-section padding="none">
        <s-grid
          gridTemplateColumns="auto auto"
          gap="small"
          padding="small"
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
        <s-grid
          gridTemplateColumns="auto"
          gap="base"
          padding="small"
          placeContent="space-between space-between"
        >
          <s-grid-item>
            <s-paragraph tone="info" padding="base">
              Displays high-level order synchronization status between Shopify
              and NetSuite.
            </s-paragraph>
          </s-grid-item>
        </s-grid>

        <s-divider style={{ margin: "16px 0" }} />

        {orders.length === 0 ? (
          <s-text tone="subdued">No order sync records available.</s-text>
        ) : (
          <s-table>
            <s-grid
              slot="filters"
              gap="small-200"
              gridTemplateColumns="1fr auto"
            >
              <s-text-field
                label="Search orders"
                labelAccessibilityVisibility="exclusive"
                icon="search"
                placeholder="Search order name, Shopify ID, NetSuite ID"
                value={search}
                onInput={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                   navigate(
  `?page=1&search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortOrder=${sortOrder}`
);
                  }
                }}
              />
              <s-button
                icon="sort"
                variant="secondary"
                accessibilityLabel="Sort"
                commandFor="sort-actions"
              />
              {/* <s-button command="--hide"
                onClick={() =>
                  navigate(`?page=1&search=${encodeURIComponent(search)}`)
                }
              >
                Search
              </s-button> */}
              <s-popover id="sort-actions">
                <s-stack gap="none">
                  <s-box padding="small">
                   <s-choice-list
  label="Sort by"
  name="sortBy"
  value={sortBy}
  onChange={(e) => {
    const newSortBy = e.currentTarget.values;

    navigate(
      `?page=1&search=${encodeURIComponent(search)}&sortBy=${newSortBy}&sortOrder=${sortOrder}`
    );
  }}
>
  <s-choice value="updatedAt">
    Updated At
  </s-choice>

  <s-choice value="shopifyOrderName">
    Shopify Order Name
  </s-choice>

  <s-choice value="netsuiteOrderId">
    NetSuite Order ID
  </s-choice>

  <s-choice value="paymentStatus">
    Payment Status
  </s-choice>
</s-choice-list>
<s-choice-list
  label="Order"
  name="sortOrder"
  value={sortOrder}
  onChange={(e) => {
    const newSortOrder = e.currentTarget.values;

    navigate(
      `?page=1&search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortOrder=${newSortOrder}`
    );
  }}
>
  <s-choice value="desc">
    Descending
  </s-choice>

  <s-choice value="asc">
    Ascending
  </s-choice>
</s-choice-list>
                  </s-box>
                </s-stack>
              </s-popover>
            </s-grid>
            <s-table-header-row>
              <s-table-header>Origin</s-table-header>
              {/* <s-table-header>Last Synced From</s-table-header> */}
              <s-table-header>Shopify Order Name</s-table-header>
              <s-table-header>NetSuite Company</s-table-header>
              <s-table-header>NetSuite Order ID</s-table-header>
              {/* <s-table-header>Shopify Order ID</s-table-header> */}
              <s-table-header>Action</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Payment Status</s-table-header>
              <s-table-header>Retry</s-table-header>
              <s-table-header>Webhook Payload</s-table-header>
              <s-table-header>Updated At</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {orders.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>
                    <s-badge tone="info">{entry.originSystem}</s-badge>
                  </s-table-cell>

                  {/* <s-table-cell>
                    <s-badge tone="warning">
                      {entry.lastSyncedFrom}
                    </s-badge>
                  </s-table-cell> */}

                  <s-table-cell>
                    <s-badge>{entry.shopifyOrderName || "-"}</s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-text font-weight="medium">
                      {entry.netsuiteCompanyId || "—"}
                    </s-text>
                  </s-table-cell>

                  <s-table-cell>{entry.netsuiteOrderId || "—"}</s-table-cell>

                  {/* <s-table-cell>
                    <s-text tone="subdued">
                      {entry.shopifyOrderId || "—"}
                    </s-text>
                  </s-table-cell> */}

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
                    {entry.paymentCapturedAt ? (
                      <s-badge tone={statusTone(entry.status)}>
                        Captured{" "}
                        {new Date(entry.paymentCapturedAt).toLocaleString(
                          "en-US",
                          {
                            // year: "2-digit",
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </s-badge>
                    ) : (
                      "-"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {entry.status === "FAILED" && !entry.netsuiteOrderId ? (
                      <s-button
                        disabled={retryingId === entry.id}
                        onClick={() => retryOrder(entry.id)}
                      >
                        {retryingId === entry.id ? "Retrying..." : "Retry"}
                      </s-button>
                    ) : (
                      "-"
                    )}
                  </s-table-cell>
                  <s-table-cell>
  <s-button
    commandFor="webhook-payload-modal"
    command="--show"
    onClick={() => setSelectedPayload(entry.webhookPayload)}
  >
    View Payload
  </s-button>
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
        <s-modal
  id="webhook-payload-modal"
  heading="Shopify Webhook Payload"
>
  <s-box padding="base">
    <pre
      style={{
        maxHeight: "65vh",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontSize: "13px",
        lineHeight: "1.5",
      }}
    >
      {selectedPayload
        ? JSON.stringify(selectedPayload, null, 2)
        : "No payload available"}
    </pre>
  </s-box>

  <s-button
    slot="primary-action"
    commandFor="webhook-payload-modal"
    command="--hide"
    onClick={() => setSelectedPayload(null)}
  >
    Close
  </s-button>
</s-modal>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "10px",
            marginTop: "20px",
          }}
        >
          <s-button
            disabled={page <= 1}
            onClick={() =>
             navigate(
  `?page=${page - 1}&search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortOrder=${sortOrder}`
)
            }
          >
            Previous
          </s-button>

          <span>
            Page {page} of {totalPages}
          </span>

          <s-button
            disabled={page >= totalPages}
            onClick={() =>
            navigate(
  `?page=${page + 1}&search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortOrder=${sortOrder}`
)
            }
          >
            Next
          </s-button>
        </div>
      </s-section>

    

     <s-toast
  id="app-toast"
  duration={5000}
>
  {toast?.message || ""}
</s-toast>
    </s-page>
  );
}

/* -------------------------
   Badge helpers
-------------------------- */

function statusTone(status) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "critical";
  if (status === "PROCESSING") return "warning";
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
