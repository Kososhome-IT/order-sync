import { Text } from "@shopify/polaris";
import { formatDistanceToNow, parseISO } from "date-fns";

export function LastSyncTimestamp({ timestamp }) {
  if (!timestamp) {
    return (
      <Text as="span" variant="bodyMd" tone="subdued">
        Never
      </Text>
    );
  }

  let relativeTime;
  try {
    const date = parseISO(timestamp);
    relativeTime = formatDistanceToNow(date, { addSuffix: true });
  } catch {
    relativeTime = "Unknown";
  }

  return (
    <Text as="span" variant="bodyMd" fontWeight="semibold">
      {relativeTime}
    </Text>
  );
}
