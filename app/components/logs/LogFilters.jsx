import { useCallback } from "react";
import {
  InlineStack,
  Select,
  TextField,
  Button,
  BlockStack,
  Box,
} from "@shopify/polaris";

const ENTITY_TYPE_OPTIONS = [
  { label: "All entity types", value: "" },
  { label: "Inventory", value: "inventory" },
  { label: "Order", value: "order" },
  { label: "Customer", value: "customer" },
];

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Success", value: "success" },
  { label: "Failed", value: "failed" },
  { label: "Skipped", value: "skipped" },
];

const DIRECTION_OPTIONS = [
  { label: "All directions", value: "" },
  { label: "NetSuite \u2192 Shopify", value: "ns_to_shopify" },
  { label: "Shopify \u2192 NetSuite", value: "shopify_to_ns" },
];

export function LogFilters({ filters, onFilterChange }) {
  const handleFieldChange = useCallback(
    (field) => (value) => {
      onFilterChange({ ...filters, [field]: value });
    },
    [filters, onFilterChange],
  );

  const handleApply = useCallback(() => {
    onFilterChange({ ...filters });
  }, [filters, onFilterChange]);

  const handleClear = useCallback(() => {
    onFilterChange({
      entityType: "",
      status: "",
      direction: "",
      dateFrom: "",
      dateTo: "",
      search: "",
    });
  }, [onFilterChange]);

  return (
    <Box paddingBlockEnd="400">
      <BlockStack gap="300">
        <InlineStack gap="300" wrap>
          <div style={{ minWidth: "160px" }}>
            <Select
              label="Entity type"
              labelHidden
              options={ENTITY_TYPE_OPTIONS}
              value={filters.entityType}
              onChange={handleFieldChange("entityType")}
            />
          </div>
          <div style={{ minWidth: "140px" }}>
            <Select
              label="Status"
              labelHidden
              options={STATUS_OPTIONS}
              value={filters.status}
              onChange={handleFieldChange("status")}
            />
          </div>
          <div style={{ minWidth: "180px" }}>
            <Select
              label="Direction"
              labelHidden
              options={DIRECTION_OPTIONS}
              value={filters.direction}
              onChange={handleFieldChange("direction")}
            />
          </div>
        </InlineStack>

        <InlineStack gap="300" wrap blockAlign="end">
          <div style={{ minWidth: "140px" }}>
            <TextField
              label="Date from"
              type="date"
              value={filters.dateFrom}
              onChange={handleFieldChange("dateFrom")}
              autoComplete="off"
            />
          </div>
          <div style={{ minWidth: "140px" }}>
            <TextField
              label="Date to"
              type="date"
              value={filters.dateTo}
              onChange={handleFieldChange("dateTo")}
              autoComplete="off"
            />
          </div>
          <div style={{ minWidth: "200px", flexGrow: 1 }}>
            <TextField
              label="Search"
              labelHidden
              placeholder="Search by ID, error message..."
              value={filters.search}
              onChange={handleFieldChange("search")}
              autoComplete="off"
              clearButton
              onClearButtonClick={() =>
                onFilterChange({ ...filters, search: "" })
              }
            />
          </div>
          <InlineStack gap="200">
            <Button onClick={handleApply} variant="primary">
              Apply
            </Button>
            <Button onClick={handleClear}>Clear</Button>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
