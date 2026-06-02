import { IndexTable, TextField, Select, Checkbox, Button } from "@shopify/polaris";

const transformOptions = [
  { label: "Direct", value: "direct" },
  { label: "Template", value: "template" },
  { label: "Lookup", value: "lookup" },
  { label: "Formula", value: "formula" },
  { label: "Custom", value: "custom" },
];

export function FieldMappingRow({
  index, netsuiteField, shopifyField, transformType, isRequired, isActive, onChange, onRemove,
}) {
  return (
    <IndexTable.Row id={String(index)} position={index}>
      <IndexTable.Cell>
        <TextField label="" labelHidden value={netsuiteField} onChange={(v) => onChange(index, "netsuiteField", v)} autoComplete="off" />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <TextField label="" labelHidden value={shopifyField} onChange={(v) => onChange(index, "shopifyField", v)} autoComplete="off" />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Select label="" labelHidden options={transformOptions} value={transformType} onChange={(v) => onChange(index, "transformType", v)} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Checkbox label="" labelHidden checked={isRequired} onChange={(v) => onChange(index, "isRequired", v)} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Checkbox label="" labelHidden checked={isActive} onChange={(v) => onChange(index, "isActive", v)} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button tone="critical" variant="plain" onClick={() => onRemove(index)}>Remove</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}
