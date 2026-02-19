import { ShopifyError } from "../services/common/errors";
import { createServiceLogger } from "../services/common/logger";
import { BATCH_SIZES, NETSUITE_METAFIELD } from "../utils/constants";

const log = createServiceLogger("shopify-order");

// ---------------------------------------------------------------------------
// GraphQL Queries
// ---------------------------------------------------------------------------

/**
 * Fragment shared between list and single-order queries so the shape is
 * consistent everywhere orders are consumed.
 */
const ORDER_FIELDS_FRAGMENT = `#graphql
  fragment OrderFields on Order {
    id
    name
    email
    createdAt
    updatedAt
    totalPriceSet {
      shopMoney { amount currencyCode }
    }
    subtotalPriceSet {
      shopMoney { amount currencyCode }
    }
    totalShippingPriceSet {
      shopMoney { amount currencyCode }
    }
    totalTaxSet {
      shopMoney { amount currencyCode }
    }
    totalDiscountsSet {
      shopMoney { amount currencyCode }
    }
    financialStatus
    fulfillmentStatus
    note
    tags
    customer {
      id
      firstName
      lastName
      email
      phone
    }
    lineItems(first: 50) {
      edges {
        node {
          id
          title
          sku
          quantity
          originalUnitPriceSet {
            shopMoney { amount currencyCode }
          }
          variant {
            id
          }
        }
      }
    }
    shippingAddress {
      firstName
      lastName
      company
      address1
      address2
      city
      province
      provinceCode
      country
      countryCodeV2
      zip
      phone
    }
    billingAddress {
      firstName
      lastName
      company
      address1
      address2
      city
      province
      provinceCode
      country
      countryCodeV2
      zip
      phone
    }
    shippingLines(first: 10) {
      edges {
        node {
          title
          originalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
    }
    metafields(
      first: 5
      namespace: "${NETSUITE_METAFIELD.NAMESPACE}"
    ) {
      edges {
        node {
          namespace
          key
          value
        }
      }
    }
  }
`;

const ORDERS_QUERY = `#graphql
  ${ORDER_FIELDS_FRAGMENT}
  query orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          ...OrderFields
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

const ORDER_BY_ID_QUERY = `#graphql
  ${ORDER_FIELDS_FRAGMENT}
  query order($id: ID!) {
    order(id: $id) {
      ...OrderFields
    }
  }
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch orders with cursor-based pagination.
 *
 * An optional `query` parameter supports the Shopify orders search syntax
 * (e.g. `"financial_status:paid"`, `"created_at:>2024-01-01"`).
 */
export async function fetchOrders(
  client,
  options = {},
) {
  const first = options.first ?? BATCH_SIZES.SHOPIFY_GRAPHQL_PAGE;

  log.debug({ first, after: options.after, query: options.query }, "Fetching orders");

  const data = await client.graphqlRequest(ORDERS_QUERY, {
    first,
    after: options.after ?? null,
    query: options.query ?? null,
  });

  const orders = data.orders.edges.map((edge) => edge.node);
  const { pageInfo } = data.orders;

  log.debug(
    { count: orders.length, hasNextPage: pageInfo.hasNextPage },
    "Fetched orders",
  );

  return { orders, pageInfo };
}

/**
 * Fetch a single order by its Shopify Global ID (GID).
 *
 * @param orderId - Full GID, e.g. `"gid://shopify/Order/1234567890"`
 */
export async function fetchOrder(
  client,
  orderId,
) {
  log.debug({ orderId }, "Fetching single order");

  const data = await client.graphqlRequest(ORDER_BY_ID_QUERY, {
    id: orderId,
  });

  if (!data.order) {
    throw new ShopifyError(`Order not found: ${orderId}`, undefined, 404);
  }

  return data.order;
}

/**
 * Fetch orders created after a given ISO date string.
 *
 * This is a convenience wrapper around {@link fetchOrders} used for fallback
 * delta polling when webhooks may have been missed.
 *
 * @param sinceDate - ISO 8601 date string, e.g. `"2024-06-15T00:00:00Z"`
 */
export async function fetchOrdersSince(
  client,
  sinceDate,
) {
  log.info({ sinceDate }, "Fetching orders since date");

  return fetchOrders(client, {
    query: `created_at:>'${sinceDate}'`,
    first: BATCH_SIZES.SHOPIFY_GRAPHQL_PAGE,
  });
}
