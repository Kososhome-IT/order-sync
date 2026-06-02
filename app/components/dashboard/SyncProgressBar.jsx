import { InlineStack, Spinner, ProgressBar, Text } from "@shopify/polaris";

export function SyncProgressBar({ isRunning, progress }) {
  if (!isRunning) {
    return null;
  }

  if (progress !== undefined && progress >= 0) {
    const clampedProgress = Math.min(100, Math.max(0, progress));

    return (
      <InlineStack gap="300" blockAlign="center">
        <div style={{ flexGrow: 1 }}>
          <ProgressBar progress={clampedProgress} tone="primary" size="small" />
        </div>
        <Text as="span" variant="bodySm" tone="subdued">
          {Math.round(clampedProgress)}%
        </Text>
      </InlineStack>
    );
  }

  return (
    <InlineStack gap="200" blockAlign="center">
      <Spinner size="small" />
      <Text as="span" variant="bodySm" tone="subdued">
        Syncing...
      </Text>
    </InlineStack>
  );
}
