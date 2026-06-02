import { ShopifyError } from "../services/common/errors";
import { createServiceLogger } from "../services/common/logger";
import { BATCH_SIZES } from "../utils/constants";

const log = createServiceLogger("shopify-inventory");

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const INVENTORY_SET_QUANTITIES_MUTATION = `#graphql
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        changes {
          name
          delta
          quantityAfterChange
          item {
            id
            sku
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_ITEMS_QUERY = `#graphql
  query inventoryItems($first: Int!, $after: String) {
    inventoryItems(first: $first, after: $after) {
      edges {
        node {
          id
          sku
          tracked
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                location {
                  id
                  name
                }
                quantities(names: ["available", "on_hand", "committed", "incoming"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const PRODUCT_VARIANTS_BY_SKU_QUERY = `#graphql
  query productVariantsBySku($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  query locations {
    locations(first: 50, includeLegacy: true, includeInactive: false) {
      edges {
        node {
          id
          name
          isActive
          fulfillmentService {
            handle
            serviceName
          }
          address {
            address1
            city
            provinceCode
            countryCode
            zip
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set absolute inventory quantities for a list of items.
 *
 * Items are batched into groups of {@link BATCH_SIZES.INVENTORY_SYNC} (50)
 * since Shopify's `inventorySetQuantities` mutation accepts up to 100 items
 * but we keep the batch smaller for cost/reliability balance.
 *
 * Uses `reason: "correction"`, `name: "available"`, and
 * `ignoreCompareQuantity: true` so the write is idempotent regardless of
 * prior state.
 */
export async function setInventoryQuantities(
  client,
  items,
) {
  if (items.length === 0) return [];

  const batchSize = BATCH_SIZES.INVENTORY_SYNC;
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);

    log.info(
      { batchIndex, batchSize: batch.length, totalItems: items.length },
      "Setting inventory quantities batch",
    );

    const input = {
      name: "available",
      reason: "correction",
      quantities: batch.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        locationId: item.locationId,
        quantity: item.quantity,
        ignoreCompareQuantity: true,
      })),
    };

    const data = await client.graphqlRequest(
      INVENTORY_SET_QUANTITIES_MUTATION,
      { input },
    );

    const { userErrors, inventoryAdjustmentGroup } = data.inventorySetQuantities;

    if (userErrors.length > 0) {
      log.error({ userErrors, batchIndex }, "Inventory set quantities userErrors");
      throw new ShopifyError(
        `Failed to set inventory quantities (batch ${batchIndex}): ${userErrors.map((e) => e.message).join("; ")}`,
        userErrors,
      );
    }

    results.push({ batchIndex, changes: inventoryAdjustmentGroup });
  }

  log.info(
    { totalItems: items.length, batches: results.length },
    "Inventory quantities set successfully",
  );

  return results;
}

/**
 * Fetch inventory items with cursor-based pagination.
 */
export async function fetchInventoryItems(
  client,
  options = {},
) {
  const first = options.first ?? BATCH_SIZES.SHOPIFY_GRAPHQL_PAGE;

  log.debug({ first, after: options.after }, "Fetching inventory items");

  const data = await client.graphqlRequest(
    INVENTORY_ITEMS_QUERY,
    { first, after: options.after ?? null },
  );

  const items = data.inventoryItems.edges.map((edge) => edge.node);
  const { pageInfo } = data.inventoryItems;

  log.debug({ count: items.length, hasNextPage: pageInfo.hasNextPage }, "Fetched inventory items");

  return { items, pageInfo };
}

/**
 * Look up product variants by a list of SKUs.
 *
 * Builds a Shopify search query of the form `sku:AAA OR sku:BBB` and returns
 * all matching variants with their inventory item IDs.
 */
export async function fetchProductVariantsBySku(
  client,
  skus,
) {
  if (skus.length === 0) return [];

  // Shopify search queries have a practical length limit; chunk if needed
  const skuQuery = skus.map((sku) => `sku:${sku}`).join(" OR ");

  log.debug({ skuCount: skus.length }, "Fetching product variants by SKU");

  const data = await client.graphqlRequest(
    PRODUCT_VARIANTS_BY_SKU_QUERY,
    { query: skuQuery, first: Math.min(skus.length, BATCH_SIZES.SHOPIFY_GRAPHQL_PAGE) },
  );

  return data.productVariants.edges.map((edge) => ({
    id: edge.node.id,
    sku: edge.node.sku,
    inventoryItemId: edge.node.inventoryItem.id,
  }));
}

/**
 * Fetch all active locations configured in the Shopify store.
 */
export async function fetchLocations(
  client,
) {
  log.debug("Fetching Shopify locations");

  const data = await client.graphqlRequest(LOCATIONS_QUERY);

  const locations = data.locations.edges.map((edge) => edge.node);

  log.info({ locationCount: locations.length }, "Fetched Shopify locations");

  return locations;
}
