import { z } from "zod";

export const netsuiteConfigSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  privateKey: z.string().min(1, "Private Key is required"),
  certificateId: z.string().min(1, "Certificate ID is required"),
  restletUrls: z.object({
    inventory: z.string().url().optional(),
    customer: z.string().url().optional(),
    salesorder: z.string().url().optional(),
  }),
  scopes: z.array(z.string()).default(["rest_webservices", "restlets"]),
});

export const fieldMappingSchema = z.object({
  entityType: z.enum(["inventory", "order", "customer"]),
  direction: z.enum(["ns_to_shopify", "shopify_to_ns", "bidirectional"]),
  netsuiteField: z.string().min(1),
  shopifyField: z.string().min(1),
  transformType: z.enum(["direct", "template", "lookup", "formula", "custom"]).default("direct"),
  transformConfig: z.record(z.unknown()).optional(),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const fieldMappingBatchSchema = z.object({
  entityType: z.enum(["inventory", "order", "customer"]),
  direction: z.enum(["ns_to_shopify", "shopify_to_ns", "bidirectional"]),
  mappings: z.array(fieldMappingSchema),
});

export const syncTriggerSchema = z.object({
  entityType: z.enum(["inventory", "order", "customer"]),
  mode: z.enum(["delta", "full"]).default("delta"),
});

export const logFilterSchema = z.object({
  entityType: z.enum(["inventory", "order", "customer"]).optional(),
  status: z.enum(["pending", "processing", "success", "failed", "skipped"]).optional(),
  direction: z.enum(["ns_to_shopify", "shopify_to_ns"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

export const syncScheduleSchema = z.object({
  entityType: z.enum(["inventory", "order", "customer"]),
  cronExpression: z.string().min(1),
  isEnabled: z.boolean(),
});
