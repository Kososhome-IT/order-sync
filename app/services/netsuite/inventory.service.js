/**
 * NetSuite Inventory service.
 *
 * Provides typed methods for fetching inventory items from NetSuite via
 * the REST Records API (single-item) and a custom RESTlet (bulk search).
 */

import { createServiceLogger } from "../services/common/logger";
import { NetSuiteError } from "../services/common/errors";
import { BATCH_SIZES } from "../utils/constants";

const log = createServiceLogger("netsuite-inventory");

// ---------------------------------------------------------------------------
// RESTlet script / deploy IDs
// ---------------------------------------------------------------------------

const RESTLET_SCRIPT_ID = "customscript_rl_inventory_search";
const RESTLET_DEPLOY_ID = "customdeploy_rl_inventory_search";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a page of inventory items from NetSuite using the bulk-search RESTlet.
 *
 * The RESTlet (`rl_inventory_search`) performs a saved-search style query on
 * the `inventoryitem` record type and returns a paginated result set.
 */
export async function fetchInventoryItems(
  client,
  options = {},
) {
  const {
    lastModifiedAfter,
    pageSize = BATCH_SIZES.INVENTORY_SYNC,
    offset = 0,
  } = options;

  const filters = [];

  if (lastModifiedAfter) {
    filters.push(["lastmodifieddate", "onOrAfter", lastModifiedAfter]);
  }

  // Always restrict to active items.
  filters.push(["isinactive", "is", "F"]);

  const columns = [
    "internalid",
    "itemid",
    "displayname",
    "description",
    "upccode",
    "quantityavailable",
    "quantityonhand",
    "quantityonorder",
    "baseprice",
    "lastmodifieddate",
    "isinactive",
    "locationquantityavailable",
    "locationquantityonhand",
  ];

  log.debug({ filters, pageSize, offset }, "Fetching inventory items via RESTlet");

  const response = await client.callRestlet(
    RESTLET_SCRIPT_ID,
    RESTLET_DEPLOY_ID,
    { filters, columns, pageSize, offset },
  );

  if (!response.success) {
    throw new NetSuiteError(
      `Inventory search failed: ${response.error?.message ?? "unknown error"}`,
      response.error?.code,
    );
  }

  const items = response.data ?? [];
  const count = response.count ?? items.length;
  const hasMore = response.hasMore ?? false;

  log.info({ count, hasMore, offset }, "Inventory items fetched");

  return { items, count, hasMore, offset };
}

/**
 * Fetch a single inventory item by its NetSuite internal ID via the REST
 * Records API.
 */
export async function fetchInventoryItem(
  client,
  internalId,
) {
  log.debug({ internalId }, "Fetching single inventory item");

  const raw = await client.get(
    `/inventoryItem/${internalId}`,
    {
      params: {
        expandSubResources: "true",
      },
    },
  );

  return mapRestRecordToInventoryItem(raw);
}

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

/**
 * Map a raw REST Records API response into our canonical
 * `NetSuiteInventoryItem` shape.
 */
function mapRestRecordToInventoryItem(raw) {
  return {
    internalId: String(raw.id ?? ""),
    itemId: String(raw.itemId ?? ""),
    displayName: String(raw.displayName ?? raw.itemId ?? ""),
    description: raw.description != null ? String(raw.description) : undefined,
    sku: raw.itemId != null ? String(raw.itemId) : undefined,
    upcCode: raw.upcCode != null ? String(raw.upcCode) : undefined,
    quantityAvailable: Number(raw.quantityAvailable ?? 0),
    quantityOnHand: Number(raw.quantityOnHand ?? 0),
    quantityOnOrder: Number(raw.quantityOnOrder ?? 0),
    basePrice: raw.basePrice != null ? Number(raw.basePrice) : undefined,
    lastModifiedDate: String(raw.lastModifiedDate ?? ""),
    isActive: raw.isInactive === false || raw.isInactive === "F",
    customFields: raw.custitem ?? undefined,
  };
}
