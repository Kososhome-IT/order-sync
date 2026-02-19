import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { format } from "date-fns";

const STATUS_BADGE_MAP = {
  pending: { tone: undefined },
  processing: { tone: "info" },
  success: { tone: "success" },
  failed: { tone: "critical" },
  skipped: { tone: "warning" },
};

const ENTITY_LABELS = {
  inventory: "Inventory",
  order: "Order",
  customer: "Customer",
};

const DIRECTION_LABELS = {
  ns_to_shopify: "NetSuite \u2192 Shopify",
  shopify_to_ns: "Shopify \u2192 NetSuite",
};

function formatTimestamp(date) {
  if (!date) return "\u2014";
  try {
    const parsed = typeof date === "string" ? new Date(date) : date;
    return format(parsed, "MMM dd, yyyy HH:mm:ss.SSS");
  } catch {
    return "Invalid date";
  }
}

function formatJson(data) {
  if (!data) return "null";
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function DetailRow({ label, children }) {
  return (
    <InlineStack gap="400" align="start">
      <Box minWidth="140px">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
      </Box>
      <Box>{children}</Box>
    </InlineStack>
  );
}

export function LogDetailModal({ log, open, onClose }) {
  if (!log) {
    return (
      <Modal open={open} onClose={onClose} title="Sync Log Details">
        <Modal.Section>
          <Text as="p">No log selected.</Text>
        </Modal.Section>
      </Modal>
    );
  }

  const statusBadge = STATUS_BADGE_MAP[log.status];

  return (
    <Modal open={open} onClose={onClose} title={`Sync Log #${log.id}`} large>
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            General
          </Text>

          <DetailRow label="Sync Run ID">
            <Text as="span" variant="bodyMd">
              {log.syncRunId}
            </Text>
          </DetailRow>

          <DetailRow label="Entity Type">
            <Badge>{ENTITY_LABELS[log.entityType]}</Badge>
          </DetailRow>

          <DetailRow label="Direction">
            <Text as="span" variant="bodyMd">
              {DIRECTION_LABELS[log.direction] ?? log.direction}
            </Text>
          </DetailRow>

          <DetailRow label="Operation">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {log.operation}
            </Text>
          </DetailRow>

          <DetailRow label="Status">
            <Badge tone={statusBadge.tone}>{log.status}</Badge>
          </DetailRow>

          <Divider />
          <Text as="h3" variant="headingSm">
            Identifiers
          </Text>

          <DetailRow label="Shopify ID">
            <Text as="span" variant="bodyMd">
              {log.shopifyId ?? "\u2014"}
            </Text>
          </DetailRow>

          <DetailRow label="NetSuite ID">
            <Text as="span" variant="bodyMd">
              {log.netsuiteId ?? "\u2014"}
            </Text>
          </DetailRow>

          <Divider />
          <Text as="h3" variant="headingSm">
            Timing
          </Text>

          <DetailRow label="Created At">
            <Text as="span" variant="bodyMd">
              {formatTimestamp(log.createdAt)}
            </Text>
          </DetailRow>

          <DetailRow label="Updated At">
            <Text as="span" variant="bodyMd">
              {formatTimestamp(log.updatedAt)}
            </Text>
          </DetailRow>

          <DetailRow label="Duration">
            <Text as="span" variant="bodyMd">
              {log.durationMs !== undefined ? `${log.durationMs}ms` : "\u2014"}
            </Text>
          </DetailRow>

          <DetailRow label="Retry Count">
            <Text as="span" variant="bodyMd">
              {log.retryCount}
            </Text>
          </DetailRow>

          {log.errorMessage && (
            <>
              <Divider />
              <Text as="h3" variant="headingSm">
                Error
              </Text>

              <DetailRow label="Error Code">
                <Text as="span" variant="bodyMd" tone="critical">
                  {log.errorCode ?? "\u2014"}
                </Text>
              </DetailRow>

              <DetailRow label="Error Message">
                <Text as="span" variant="bodyMd" tone="critical">
                  {log.errorMessage}
                </Text>
              </DetailRow>
            </>
          )}

          <Divider />
          <Text as="h3" variant="headingSm">
            Request Payload
          </Text>
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "12px",
                fontFamily: "monospace",
                maxHeight: "300px",
                overflow: "auto",
              }}
            >
              {formatJson(log.requestPayload)}
            </pre>
          </Box>

          <Text as="h3" variant="headingSm">
            Response Payload
          </Text>
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "12px",
                fontFamily: "monospace",
                maxHeight: "300px",
                overflow: "auto",
              }}
            >
              {formatJson(log.responsePayload)}
            </pre>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
