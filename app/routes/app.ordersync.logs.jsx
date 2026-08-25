import { useLoaderData, useNavigate } from "react-router";
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

  const page = Number(url.searchParams.get("page") || 1);
  const search = url.searchParams.get("search") || "";

  const sortBy = url.searchParams.get("sortBy") || "createdAt";
  const sortOrder = url.searchParams.get("sortOrder") || "desc";

  const pageSize = 50;

  const where = {};

  if (search) {
    where.OR = [
      {
        message: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        eventType: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        status: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        sourceSystem: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        direction: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        orderSync: {
          shopifyOrderName: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
      {
        orderSync: {
          shopifyOrderId: {
            contains: search,
          },
        },
      },
      {
        orderSync: {
          netsuiteOrderId: {
            contains: search,
          },
        },
      },
    ];
  }

  const allowedSortFields = {
    createdAt: "createdAt",
    status: "status",
    eventType: "eventType",
    sourceSystem: "sourceSystem",
    direction: "direction",
  };

  let orderBy;

  if (sortBy === "shopifyOrderName") {
    orderBy = {
      orderSync: {
        shopifyOrderName: sortOrder === "asc" ? "asc" : "desc",
      },
    };
  } else if (sortBy === "netsuiteOrderId") {
    orderBy = {
      orderSync: {
        netsuiteOrderId: sortOrder === "asc" ? "asc" : "desc",
      },
    };
  } else {
    orderBy = {
      [allowedSortFields[sortBy] || "createdAt"]:
        sortOrder === "asc" ? "asc" : "desc",
    };
  }

  const totalCount = await prisma.orderSyncLog.count({
    where,
  });

  const logs = await prisma.orderSyncLog.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      orderSync: true,
    },
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

export default function OrderSyncLogDashboard() {
 const {
  logs,
  page,
  totalPages,
  search: loaderSearch,
  sortBy,
  sortOrder,
} = useLoaderData();
const navigate = useNavigate();
const [selectedMessage, setSelectedMessage] = useState(null);
const [selectedDetails, setSelectedDetails] = useState(null);
const [search, setSearch] = useState(loaderSearch || "");
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

  <s-grid
    slot="filters"
    gap="small-200"
    gridTemplateColumns="1fr auto"
  >
    <s-text-field
      label="Search logs"
      labelAccessibilityVisibility="exclusive"
      icon="search"
      placeholder="Search order, NetSuite ID, message, event..."
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
      commandFor="log-sort-actions"
    />

    <s-popover id="log-sort-actions">
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
            <s-choice value="createdAt">
              Created At
            </s-choice>

            <s-choice value="shopifyOrderName">
              Shopify Order Name
            </s-choice>

            <s-choice value="netsuiteOrderId">
              NetSuite Order ID
            </s-choice>

            <s-choice value="status">
              Status
            </s-choice>

            <s-choice value="eventType">
              Event
            </s-choice>

            <s-choice value="sourceSystem">
              Source
            </s-choice>

            <s-choice value="direction">
              Direction
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
              <s-table-header>Shopify Order</s-table-header>
              <s-table-header>Shopify Order Name</s-table-header>
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
   <s-badge>{log.orderSync?.shopifyOrderName || "-"}</s-badge>
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
 
 <s-button
  commandFor="log-message-modal"
  command="--show"
  onClick={() => setSelectedMessage(log.message)}
>
  {log.message
    ? log.message.length > 60
      ? `${log.message.substring(0, 60)}...`
      : log.message
    : "—"}
</s-button>
</s-table-cell>

                 <s-table-cell>
  <s-button
    commandFor="log-details-modal"
    command="--show"
    onClick={() =>
      setSelectedDetails({
        requestPayload: log.requestPayload,
        responsePayload: log.responsePayload,
        errorPayload: log.errorPayload,
        rawPayload: log.rawPayload,
      })
    }
  >
    View
  </s-button>
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
        {<s-modal
  id="log-message-modal"
  heading="Log Message"
>
  <s-box padding="base">
    <s-text>
      {selectedMessage || "No message available"}
    </s-text>
  </s-box>

  <s-button
    slot="primary-action"
    commandFor="log-message-modal"
    command="--hide"
    onClick={() => setSelectedMessage(null)}
  >
    Close
  </s-button>
</s-modal>
}
{<s-modal
  id="log-details-modal"
  heading="Log Details"
>
  <s-box padding="base">
    <s-stack gap="base">
      <s-box>
        <s-heading>Request Payload</s-heading>
        <pre>
          {JSON.stringify(
            selectedDetails?.requestPayload ?? null,
            null,
            2
          )}
        </pre>
      </s-box>

      <s-box>
        <s-heading>Response Payload</s-heading>
        <pre>
          {JSON.stringify(
            selectedDetails?.responsePayload ?? null,
            null,
            2
          )}
        </pre>
      </s-box>

      <s-box>
        <s-heading>Error Payload</s-heading>
        <pre>
          {JSON.stringify(
            selectedDetails?.errorPayload ?? null,
            null,
            2
          )}
        </pre>
      </s-box>

      <s-box>
        <s-heading>Raw Payload</s-heading>
        <pre>
          {JSON.stringify(
            selectedDetails?.rawPayload ?? null,
            null,
            2
          )}
        </pre>
      </s-box>
    </s-stack>
  </s-box>

  <s-button
    slot="primary-action"
    commandFor="log-details-modal"
    command="--hide"
    onClick={() => setSelectedDetails(null)}
  >
    Close
  </s-button>
</s-modal>}
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
