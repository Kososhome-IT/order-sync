import { BlockStack, InlineStack, Button, IndexTable, TextField, Select, Checkbox } from "@shopify/polaris";

const transformOptions = [
  { label: "Direct", value: "direct" },
  { label: "Template", value: "template" },
  { label: "Lookup", value: "lookup" },
  { label: "Formula", value: "formula" },
  { label: "Custom", value: "custom" },
];

export function FieldMappingEditor({
  mappings, onChange, onAdd, onRemove, onLoadDefaults, onSave, isSaving,
}) {
  return (
    <BlockStack gap="400">
      <IndexTable
        resourceName={{ singular: "mapping", plural: "mappings" }}
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
        {mappings.map((m, i) => (
          <IndexTable.Row id={String(i)} key={i} position={i}>
            <IndexTable.Cell>
              <TextField label="" labelHidden value={m.netsuiteField} onChange={(v) => onChange(i, "netsuiteField", v)} autoComplete="off" />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <TextField label="" labelHidden value={m.shopifyField} onChange={(v) => onChange(i, "shopifyField", v)} autoComplete="off" />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Select label="" labelHidden options={transformOptions} value={m.transformType} onChange={(v) => onChange(i, "transformType", v)} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Checkbox label="" labelHidden checked={m.isRequired} onChange={(v) => onChange(i, "isRequired", v)} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Checkbox label="" labelHidden checked={m.isActive} onChange={(v) => onChange(i, "isActive", v)} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Button tone="critical" variant="plain" onClick={() => onRemove(i)}>Remove</Button>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>

      <InlineStack gap="300">
        <Button onClick={onAdd}>Add Mapping</Button>
        <Button onClick={onLoadDefaults}>Load Defaults</Button>
        <Button variant="primary" onClick={onSave} loading={isSaving}>Save</Button>
      </InlineStack>
    </BlockStack>
  );
}
