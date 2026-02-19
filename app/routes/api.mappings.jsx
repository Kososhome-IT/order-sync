import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import * as fieldMappingModel from "../models/field-mapping.model";
import { fieldMappingBatchSchema } from "../utils/validators";

export async function loader({ request }) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");

  if (!entityType || !["inventory", "order", "customer"].includes(entityType)) {
    return json({ error: "Valid entityType parameter required" }, { status: 400 });
  }

  const mappings = await fieldMappingModel.getAllFieldMappings(entityType);
  return json({ mappings });
}

export async function action({ request }) {
  await authenticate.admin(request);

  const method = request.method.toUpperCase();

  if (method === "PUT") {
    const body = await request.json();
    const parsed = fieldMappingBatchSchema.safeParse(body);

    if (!parsed.success) {
      return json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { entityType, direction, mappings } = parsed.data;

    const result = await fieldMappingModel.replaceFieldMappings(
      entityType,
      direction,
      mappings.map((m) => ({
        entityType: m.entityType,
        direction: m.direction,
        netsuiteField: m.netsuiteField,
        shopifyField: m.shopifyField,
        transformType: m.transformType,
        transformConfig: m.transformConfig,
        isRequired: m.isRequired,
        isActive: m.isActive,
        sortOrder: m.sortOrder,
      })),
    );

    return json({ success: true, mappings: result });
  }

  if (method === "DELETE") {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return json({ error: "Mapping id required" }, { status: 400 });
    }

    await fieldMappingModel.deleteFieldMapping(id);
    return json({ success: true });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}
