import { createServiceLogger } from "../services/common/logger";
import { getFieldMappings } from "../models/field-mapping.model";

const log = createServiceLogger("field-mapper");

export class FieldMapper {
  constructor() {
    this.mappings = [];
  }

  async loadMappings(entityType, direction) {
    this.mappings = await getFieldMappings(entityType, direction);
    log.debug({ entityType, direction, count: this.mappings.length }, "Loaded field mappings");
  }

  setMappings(mappings) {
    this.mappings = mappings;
  }

  transform(
    source,
    direction,
  ) {
    const result = {};

    for (const mapping of this.mappings) {
      if (!mapping.isActive) continue;

      const sourceField = direction === "ns_to_shopify" ? mapping.netsuiteField : mapping.shopifyField;
      const targetField = direction === "ns_to_shopify" ? mapping.shopifyField : mapping.netsuiteField;

      const sourceValue = getNestedValue(source, sourceField);

      if (sourceValue === undefined && mapping.isRequired) {
        log.warn({ sourceField, targetField }, "Required field missing from source");
        continue;
      }

      if (sourceValue === undefined) continue;

      const transformedValue = applyTransform(
        sourceValue,
        mapping.transformType,
        mapping.transformConfig,
      );

      setNestedValue(result, targetField, transformedValue);
    }

    return result;
  }

  getMappings() {
    return this.mappings;
  }
}

function getNestedValue(obj, path) {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = current[part];
  }

  return current;
}

function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function applyTransform(
  value,
  transformType,
  config,
) {
  switch (transformType) {
    case "direct":
      return value;

    case "template":
      if (!config?.template || typeof value !== "string") return value;
      return config.template.replace(/\{\{value\}\}/g, value);

    case "lookup":
      if (!config?.lookupTable) return value;
      return config.lookupTable[String(value)] ?? config.defaultValue ?? value;

    case "formula": {
      if (!config?.numberFormat) return value;
      const num = Number(value);
      if (isNaN(num)) return value;
      const multiplier = config.numberFormat.multiplier ?? 1;
      const decimals = config.numberFormat.decimals ?? 2;
      return Number((num * multiplier).toFixed(decimals));
    }

    case "custom":
      return value;

    default:
      return value;
  }
}

export function createFieldMapper() {
  return new FieldMapper();
}
