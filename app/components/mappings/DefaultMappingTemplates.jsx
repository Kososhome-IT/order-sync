import { Card, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";
import {
  DEFAULT_INVENTORY_MAPPINGS,
  DEFAULT_ORDER_MAPPINGS,
  DEFAULT_CUSTOMER_MAPPINGS,
} from "../types/mapping.types";

export function DefaultMappingTemplates({ entityType, onLoad }) {
  const defaults =
    entityType === "inventory"
      ? DEFAULT_INVENTORY_MAPPINGS
      : entityType === "order"
        ? DEFAULT_ORDER_MAPPINGS
        : DEFAULT_CUSTOMER_MAPPINGS;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text variant="headingSm" as="h3">Default Template</Text>
          <Button size="slim" onClick={() => onLoad(defaults)}>Load Defaults</Button>
        </InlineStack>
        <Text as="p" tone="subdued">
          Load {defaults.length} pre-configured field mappings for {entityType} sync.
        </Text>
      </BlockStack>
    </Card>
  );
}
