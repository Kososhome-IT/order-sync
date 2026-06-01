/**
 * NetSuite Sales Order service.
 *
 * Provides typed methods for creating, reading, and searching sales orders
 * in NetSuite via the REST Records API and custom RESTlets.
 */

import { createServiceLogger } from "../services/common/logger";
import { NetSuiteError } from "../services/common/errors";

const log = createServiceLogger("netsuite-salesorder");

// ---------------------------------------------------------------------------
// RESTlet script / deploy IDs (for search-by-Shopify-ID and creation)
// ---------------------------------------------------------------------------

const RESTLET_SCRIPT_ID = "customscript_rl_salesorder_create";
const RESTLET_DEPLOY_ID = "customdeploy_rl_salesorder_create";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new sales order in NetSuite.
 *
 * Uses the custom `rl_salesorder_create` RESTlet which handles line-item
 * population, custom-field mapping, and returns the created record's
 * internal ID and transaction ID.
 */
export async function createSalesOrder(client, order) {
  log.info(
    {
      entity: order.entity,
      itemCount: order.item?.items?.length || 0,
    },
    "Creating sales order",
  );

  const response = await client.createOrder(order);

  if (!response.success) {
    throw new NetSuiteError(
      `Sales order creation failed`,
    );
  }

  log.info(
    { status: response.status },
    "Sales order created",
  );

  return response;
}

/**
 * Fetch a single sales order by its NetSuite internal ID via the REST
 * Records API.
 */
export async function getSalesOrder(
  client,
  internalId,
) {
  log.debug({ internalId }, "Fetching sales order");

  const raw = await client.get(
    `/salesOrder/${internalId}`,
    {
      params: { expandSubResources: "true" },
    },
  );

  return mapRestRecordToSalesOrder(raw);
}

/**
 * Find a sales order using the Shopify Order ID stored in a custom body
 * field (custbody_shopify_order_id).
 *
 * Uses a RESTlet search because the REST Records API does not support
 * arbitrary custom-field searches out of the box.
 */
export async function findSalesOrderByShopifyId(
  client,
  shopifyOrderId,
) {
  log.debug({ shopifyOrderId }, "Searching for sales order by Shopify order ID");

  const response = await client.callRestlet(
    RESTLET_SCRIPT_ID,
    RESTLET_DEPLOY_ID,
    {
      operation: "search",
      filters: [
        ["custbody_shopify_order_id", "is", shopifyOrderId],
        "AND",
        ["mainline", "is", "T"],
      ],
    },
  );

  if (!response.success) {
    throw new NetSuiteError(
      `Sales order search failed: ${response.error?.message ?? "unknown error"}`,
      response.error?.code,
    );
  }

  const results = response.data ?? [];
  if (results.length === 0) {
    log.debug({ shopifyOrderId }, "No sales order found for Shopify order ID");
    return null;
  }

  return results[0];
}

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

function mapRestRecordToSalesOrder(raw) {
  const itemList = raw.item;
  const items = (itemList?.items ?? []).map((li) => ({
    item: String(li.item ?? ""),
    quantity: Number(li.quantity ?? 0),
    rate: Number(li.rate ?? 0),
    amount: Number(li.amount ?? 0),
    description: li.description != null ? String(li.description) : undefined,
    taxCode: li.taxCode != null ? String(li.taxCode) : undefined,
  }));

  const mapAddress = (addr) => {
    if (!addr) return undefined;
    return {
      internalId: addr.internalId != null ? String(addr.internalId) : undefined,
      addr1: addr.addr1 != null ? String(addr.addr1) : undefined,
      addr2: addr.addr2 != null ? String(addr.addr2) : undefined,
      city: addr.city != null ? String(addr.city) : undefined,
      state: addr.state != null ? String(addr.state) : undefined,
      zip: addr.zip != null ? String(addr.zip) : undefined,
      country: addr.country != null ? String(addr.country) : undefined,
    };
  };

  return {
    internalId: raw.id != null ? String(raw.id) : undefined,
    tranId: raw.tranId != null ? String(raw.tranId) : undefined,
    entity: String(raw.entity ?? ""),
    tranDate: String(raw.tranDate ?? ""),
    status: raw.status != null ? String(raw.status) : undefined,
    items,
    shippingAddress: mapAddress(raw.shippingAddress),
    billingAddress: mapAddress(raw.billingAddress),
    shippingCost: raw.shippingCost != null ? Number(raw.shippingCost) : undefined,
    discountTotal: raw.discountTotal != null ? Number(raw.discountTotal) : undefined,
    subtotal: raw.subtotal != null ? Number(raw.subtotal) : undefined,
    total: raw.total != null ? Number(raw.total) : undefined,
    memo: raw.memo != null ? String(raw.memo) : undefined,
    customFields: raw.custbody ?? undefined,
  };
}
