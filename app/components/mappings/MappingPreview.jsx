import { Card, BlockStack, Text, InlineGrid, Box } from "@shopify/polaris";

export function MappingPreview({ source, result, direction }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h3">Transform Preview</Text>
        <InlineGrid columns={2} gap="400">
          <Box>
            <Text variant="headingSm" as="h4">
              {direction === "ns_to_shopify" ? "NetSuite (Source)" : "Shopify (Source)"}
            </Text>
            <pre style={{ fontSize: "11px", whiteSpace: "pre-wrap", background: "#f6f6f6", padding: "8px", borderRadius: "4px" }}>
              {JSON.stringify(source, null, 2)}
            </pre>
          </Box>
          <Box>
            <Text variant="headingSm" as="h4">
              {direction === "ns_to_shopify" ? "Shopify (Result)" : "NetSuite (Result)"}
            </Text>
            <pre style={{ fontSize: "11px", whiteSpace: "pre-wrap", background: "#f0fff0", padding: "8px", borderRadius: "4px" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </Box>
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}
