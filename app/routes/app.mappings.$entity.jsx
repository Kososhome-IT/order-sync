import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useParams } from "react-router";
import {
  Card,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Select,
  TextField,
  Checkbox,
  IndexTable,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getAllFieldMappings } from "../models/field-mapping.model";
import {
  DEFAULT_INVENTORY_MAPPINGS,
  DEFAULT_ORDER_MAPPINGS,
  DEFAULT_CUSTOMER_MAPPINGS,
} from "../types/mapping.types";

export async function loader({ request, params }) {
  await authenticate.admin(request);

  const entityType = params.entity;
  if (!["inventory", "order", "customer"].includes(entityType)) {
    throw new Response("Not found", { status: 404 });
  }

  const mappings = await getAllFieldMappings(entityType);

  return json({ mappings, entityType });
}

export default function EntityMappings() {
  const { mappings: initialMappings, entityType } = useLoaderData();
  const [mappings, setMappings] = useState(
    initialMappings.map((m) => ({
      id: m.id,
      netsuiteField: m.netsuiteField,
      shopifyField: m.shopifyField,
      transformType: m.transformType,
      isRequired: m.isRequired,
      isActive: m.isActive,
      sortOrder: m.sortOrder,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const direction =
    entityType === "inventory"
      ? "ns_to_shopify"
      : entityType === "order"
        ? "shopify_to_ns"
        : "bidirectional";

  const handleChange = useCallback((index, field, value) => {
    setMappings((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const handleAdd = useCallback(() => {
    setMappings((prev) => [
      ...prev,
      {
        netsuiteField: "",
        shopifyField: "",
        transformType: "direct",
        isRequired: false,
        isActive: true,
        sortOrder: prev.length,
      },
    ]);
  }, []);

  const handleRemove = useCallback((index) => {
    setMappings((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleLoadDefaults = useCallback(() => {
    const defaults =
      entityType === "inventory"
        ? DEFAULT_INVENTORY_MAPPINGS
        : entityType === "order"
          ? DEFAULT_ORDER_MAPPINGS
          : DEFAULT_CUSTOMER_MAPPINGS;

    setMappings(
      defaults.map((m, i) => ({
        netsuiteField: m.netsuiteField,
        shopifyField: m.shopifyField,
        transformType: m.transformType,
        isRequired: m.isRequired,
        isActive: m.isActive,
        sortOrder: i,
      })),
    );
  }, [entityType]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          direction,
          mappings: mappings.map((m, i) => ({
            entityType,
            direction,
            netsuiteField: m.netsuiteField,
            shopifyField: m.shopifyField,
            transformType: m.transformType,
            isRequired: m.isRequired,
            isActive: m.isActive,
            sortOrder: i,
          })),
        }),
      });
      const data = await res.json();
      setResult({
        success: !!data.success,
        message: data.success ? "Mappings saved" : data.error || "Save failed",
      });
    } catch {
      setResult({ success: false, message: "Failed to save mappings" });
    } finally {
      setSaving(false);
    }
  }, [entityType, direction, mappings]);

  const transformOptions = [
    { label: "Direct", value: "direct" },
    { label: "Template", value: "template" },
    { label: "Lookup", value: "lookup" },
    { label: "Formula", value: "formula" },
    { label: "Custom", value: "custom" },
  ];

  const resourceName = { singular: "mapping", plural: "mappings" };

  return (
    <Card>
      <BlockStack gap="400">
        {result && (
          <Banner tone={result.success ? "success" : "critical"} onDismiss={() => setResult(null)}>
            {result.message}
          </Banner>
        )}

        <IndexTable
          resourceName={resourceName}
          itemCount={mappings.length}
          headings={[
            { title: "NetSuite Field" },
            { title: "Shopify Field" },
            { title: "Transform" },
            { title: "Required" },
            { title: "Active" },
            { title: "" },
          ]}
          selectable={false}
        >
          {mappings.map((m, index) => (
            <IndexTable.Row id={String(index)} key={index} position={index}>
              <IndexTable.Cell>
                <TextField
                  label=""
                  labelHidden
                  value={m.netsuiteField}
                  onChange={(val) => handleChange(index, "netsuiteField", val)}
                  autoComplete="off"
                  placeholder="e.g., itemId"
                />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <TextField
                  label=""
                  labelHidden
                  value={m.shopifyField}
                  onChange={(val) => handleChange(index, "shopifyField", val)}
                  autoComplete="off"
                  placeholder="e.g., sku"
                />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Select
                  label=""
                  labelHidden
                  options={transformOptions}
                  value={m.transformType}
                  onChange={(val) => handleChange(index, "transformType", val)}
                />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Checkbox
                  label=""
                  labelHidden
                  checked={m.isRequired}
                  onChange={(val) => handleChange(index, "isRequired", val)}
                />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Checkbox
                  label=""
                  labelHidden
                  checked={m.isActive}
                  onChange={(val) => handleChange(index, "isActive", val)}
                />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Button tone="critical" variant="plain" onClick={() => handleRemove(index)}>
                  Remove
                </Button>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>

        <InlineStack gap="300">
          <Button onClick={handleAdd}>Add Mapping</Button>
          <Button onClick={handleLoadDefaults}>Load Defaults</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save Mappings
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
