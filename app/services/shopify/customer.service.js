import { ShopifyError } from "../services/common/errors";
import { createServiceLogger } from "../services/common/logger";
import { BATCH_SIZES, NETSUITE_METAFIELD } from "../utils/constants";

const log = createServiceLogger("shopify-customer");

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const CUSTOMER_FIELDS_FRAGMENT = `#graphql
  fragment CustomerFields on Customer {
    id
    firstName
    lastName
    email
    phone
    createdAt
    updatedAt
    tags
    note
    defaultAddress {
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
    addresses {
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

const CUSTOMER_CREATE_MUTATION = `#graphql
  ${CUSTOMER_FIELDS_FRAGMENT}
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        ...CustomerFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_UPDATE_MUTATION = `#graphql
  ${CUSTOMER_FIELDS_FRAGMENT}
  mutation customerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        ...CustomerFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMERS_QUERY = `#graphql
  ${CUSTOMER_FIELDS_FRAGMENT}
  query customers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          ...CustomerFields
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

const CUSTOMER_BY_ID_QUERY = `#graphql
  ${CUSTOMER_FIELDS_FRAGMENT}
  query customer($id: ID!) {
    customer(id: $id) {
      ...CustomerFields
    }
  }
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new customer in Shopify.
 *
 * Automatically attaches a NetSuite internal ID metafield when provided in
 * the input's `metafields` array.  If you want to set the NetSuite mapping
 * during creation, include a metafield with namespace/key from
 * {@link NETSUITE_METAFIELD}.
 */
export async function createCustomer(
  client,
  input,
) {
  log.info({ email: input.email }, "Creating Shopify customer");

  const data = await client.graphqlRequest(
    CUSTOMER_CREATE_MUTATION,
    { input },
  );

  const { customer, userErrors } = data.customerCreate;

  if (userErrors.length > 0) {
    log.error({ userErrors, email: input.email }, "customerCreate userErrors");
    throw new ShopifyError(
      `Failed to create customer: ${userErrors.map((e) => e.message).join("; ")}`,
      userErrors,
    );
  }

  if (!customer) {
    throw new ShopifyError("customerCreate returned null customer without userErrors");
  }

  log.info({ customerId: customer.id, email: customer.email }, "Customer created");

  return customer;
}

/**
 * Update an existing customer by their Shopify GID.
 *
 * @param id - Full GID, e.g. `"gid://shopify/Customer/1234567890"`
 */
export async function updateCustomer(
  client,
  id,
  input,
) {
  log.info({ customerId: id }, "Updating Shopify customer");

  const data = await client.graphqlRequest(
    CUSTOMER_UPDATE_MUTATION,
    { input: { ...input, id } },
  );

  const { customer, userErrors } = data.customerUpdate;

  if (userErrors.length > 0) {
    log.error({ userErrors, customerId: id }, "customerUpdate userErrors");
    throw new ShopifyError(
      `Failed to update customer ${id}: ${userErrors.map((e) => e.message).join("; ")}`,
      userErrors,
    );
  }

  if (!customer) {
    throw new ShopifyError(`customerUpdate returned null customer for ${id} without userErrors`);
  }

  log.info({ customerId: customer.id }, "Customer updated");

  return customer;
}

/**
 * Fetch customers with cursor-based pagination.
 *
 * An optional `query` parameter supports the Shopify customers search syntax
 * (e.g. `"email:john@example.com"`, `"updated_at:>2024-01-01"`).
 */
export async function fetchCustomers(
  client,
  options = {},
) {
  const first = options.first ?? BATCH_SIZES.SHOPIFY_GRAPHQL_PAGE;

  log.debug({ first, after: options.after, query: options.query }, "Fetching customers");

  const data = await client.graphqlRequest(CUSTOMERS_QUERY, {
    first,
    after: options.after ?? null,
    query: options.query ?? null,
  });

  const customers = data.customers.edges.map((edge) => edge.node);
  const { pageInfo } = data.customers;

  log.debug(
    { count: customers.length, hasNextPage: pageInfo.hasNextPage },
    "Fetched customers",
  );

  return { customers, pageInfo };
}

/**
 * Fetch a single customer by their Shopify GID.
 *
 * @param id - Full GID, e.g. `"gid://shopify/Customer/1234567890"`
 */
export async function fetchCustomer(
  client,
  id,
) {
  log.debug({ customerId: id }, "Fetching single customer");

  const data = await client.graphqlRequest(CUSTOMER_BY_ID_QUERY, {
    id,
  });

  if (!data.customer) {
    throw new ShopifyError(`Customer not found: ${id}`, undefined, 404);
  }

  return data.customer;
}

/**
 * Find a customer by their email address.
 *
 * Returns `null` if no customer matches. If multiple customers share the
 * same email, the first result is returned (Shopify sorts by relevance).
 */
export async function findCustomerByEmail(
  client,
  email,
) {
  log.debug({ email }, "Searching for customer by email");

  const { customers } = await fetchCustomers(client, {
    query: `email:${email}`,
    first: 1,
  });

  if (customers.length === 0) {
    log.debug({ email }, "No customer found for email");
    return null;
  }

  return customers[0];
}
