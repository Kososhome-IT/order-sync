import { useCallback } from "react";
import { IndexTable, Badge, Text, useBreakpoints } from "@shopify/polaris";
import { format } from "date-fns";

const ENTITY_BADGE_MAP = {
  inventory: { tone: "info", label: "Inventory" },
  order: { tone: "success", label: "Order" },
  customer: { tone: "warning", label: "Customer" },
};

const STATUS_BADGE_MAP = {
  pending: { tone: undefined },
  processing: { tone: "info" },
  success: { tone: "success" },
  failed: { tone: "critical" },
  skipped: { tone: "warning" },
};

const DIRECTION_LABELS = {
  ns_to_shopify: "NS \u2192 Shopify",
  shopify_to_ns: "Shopify \u2192 NS",
};

function truncateId(id, maxLength = 16) {
  if (!id) return "\u2014";
  if (id.length <= maxLength) return id;
  return `${id.substring(0, maxLength)}\u2026`;
}

function formatTimestamp(date) {
  try {
    const parsed = typeof date === "string" ? new Date(date) : date;
    return format(parsed, "MMM dd, yyyy HH:mm:ss");
  } catch {
    return "Invalid date";
  }
}

function formatDuration(ms) {
  if (ms === undefined || ms === null) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const resourceName = {
  singular: "sync log",
  plural: "sync logs",
};

export function LogTable({ logs, onRowClick }) {
  const { smUp } = useBreakpoints();

  const handleRowClick = useCallback(
    (id) => {
      onRowClick(Number(id));
    },
    [onRowClick],
  );

  const rowMarkup = logs.map((log, index) => {
    const entityBadge = ENTITY_BADGE_MAP[log.entityType];
    const statusBadge = STATUS_BADGE_MAP[log.status];

    return (
      <IndexTable.Row
        id={String(log.id)}
        key={log.id}
        position={index}
        onClick={() => handleRowClick(String(log.id))}
      >
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatTimestamp(log.createdAt)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={entityBadge.tone}>{entityBadge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {DIRECTION_LABELS[log.direction]}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {truncateId(log.shopifyId)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {truncateId(log.netsuiteId)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {log.operation}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusBadge.tone}>{log.status}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatDuration(log.durationMs)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <IndexTable
      condensed={!smUp}
      resourceName={resourceName}
      itemCount={logs.length}
      headings={[
        { title: "Timestamp" },
        { title: "Entity" },
        { title: "Direction" },
        { title: "Shopify ID" },
        { title: "NetSuite ID" },
        { title: "Operation" },
        { title: "Status" },
        { title: "Duration" },
      ]}
      selectable={false}
    >
      {rowMarkup}
    </IndexTable>
  );
}
