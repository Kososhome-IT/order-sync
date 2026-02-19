import { useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  Divider,
} from "@shopify/polaris";
import { LastSyncTimestamp } from "./LastSyncTimestamp";
import { ErrorCountBadge } from "./ErrorCountBadge";
import { SyncProgressBar } from "./SyncProgressBar";

const STATUS_BADGE_MAP = {
  idle: { tone: "success", label: "Idle" },
  running: { tone: "info", label: "Running" },
  paused: { tone: "warning", label: "Paused" },
  failed: { tone: "critical", label: "Failed" },
};

const ENTITY_LABELS = {
  inventory: "Inventory",
  order: "Orders",
  customer: "Customers",
};

export function SyncStatusCard({
  entityType,
  status,
  lastSyncAt,
  recordsSynced,
  recordsFailed,
  errorCount24h,
  isEnabled,
  onSyncNow,
  progress,
}) {
  const handleSyncNow = useCallback(() => {
    onSyncNow();
  }, [onSyncNow]);

  const { tone, label } = STATUS_BADGE_MAP[status];
  const isRunning = status === "running";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {ENTITY_LABELS[entityType]}
            </Text>
            <Badge tone={tone}>{label}</Badge>
          </InlineStack>
          <Button
            onClick={handleSyncNow}
            disabled={isRunning || !isEnabled}
            loading={isRunning}
            variant="primary"
          >
            Sync Now
          </Button>
        </InlineStack>

        <SyncProgressBar isRunning={isRunning} progress={progress} />

        <Divider />

        <InlineStack gap="800" align="start">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Last Sync
            </Text>
            <LastSyncTimestamp timestamp={lastSyncAt} />
          </BlockStack>

          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Records Synced
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {recordsSynced.toLocaleString()}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Records Failed
            </Text>
            <Text
              as="span"
              variant="bodyMd"
              fontWeight="semibold"
              tone={recordsFailed > 0 ? "critical" : undefined}
            >
              {recordsFailed.toLocaleString()}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Errors (24h)
            </Text>
            <ErrorCountBadge count={errorCount24h} threshold={10} />
          </BlockStack>
        </InlineStack>

        {!isEnabled && (
          <Box>
            <Text as="span" variant="bodySm" tone="caution">
              Sync is currently disabled for this entity type.
            </Text>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}
