// /**  not in use right now will see later
//  * NetSuite Customer service.
//  *
//  * Full CRUD operations for NetSuite customer records using the REST Records
//  * API (single record ops) and a custom RESTlet (bulk search / email lookup).
//  */

// import { createServiceLogger } from "../services/common/logger";
// import { NetSuiteError } from "../services/common/errors";
// import { BATCH_SIZES } from "../utils/constants";

// const log = createServiceLogger("netsuite-customer");

// // ---------------------------------------------------------------------------
// // RESTlet script / deploy IDs
// // ---------------------------------------------------------------------------

// const RESTLET_SCRIPT_ID = "customscript_rl_customer_sync";
// const RESTLET_DEPLOY_ID = "customdeploy_rl_customer_sync";

// // ---------------------------------------------------------------------------
// // Public API
// // ---------------------------------------------------------------------------

// /**
//  * Fetch a paginated list of customers from NetSuite using the bulk-search
//  * RESTlet.
//  */
// export async function fetchCustomers(
//   client,
//   options = {},
// ) {
//   const {
//     lastModifiedAfter,
//     pageSize = BATCH_SIZES.CUSTOMER_SYNC,
//     offset = 0,
//   } = options;

//   const filters = [];

//   if (lastModifiedAfter) {
//     filters.push(["lastmodifieddate", "onOrAfter", lastModifiedAfter]);
//   }

//   // Only active customers.
//   filters.push(["isinactive", "is", "F"]);

//   log.debug({ filters, pageSize, offset }, "Fetching customers via RESTlet");

//   const response = await client.callRestlet(
//     RESTLET_SCRIPT_ID,
//     RESTLET_DEPLOY_ID,
//     {
//       operation: "search",
//       filters,
//       pageSize,
//       offset,
//     },
//   );

//   if (!response.success) {
//     throw new NetSuiteError(
//       `Customer search failed: ${response.error?.message ?? "unknown error"}`,
//       response.error?.code,
//     );
//   }

//   const items = response.data ?? [];
//   const count = response.count ?? items.length;
//   const hasMore = response.hasMore ?? false;

//   log.info({ count, hasMore, offset }, "Customers fetched");

//   return { items, count, hasMore, offset };
// }

// /**
//  * Fetch a single customer by internal ID via the REST Records API.
//  */
// export async function fetchCustomer(
//   client,
//   internalId,
// ) {
//   log.debug({ internalId }, "Fetching single customer");

//   const raw = await client.get(
//     `/customer/${internalId}`,
//     {
//       params: { expandSubResources: "true" },
//     },
//   );

//   return mapRestRecordToCustomer(raw);
// }

// /**
//  * Create a new customer record in NetSuite via the REST Records API.
//  */
// export async function createCustomer(
//   client,
//   customer,
// ) {
//   log.info({ email: customer.email, entityId: customer.entityId }, "Creating customer");

//   const body = buildCustomerBody(customer);

//   const raw = await client.post("/customer", body);

//   // REST Records API returns the created record with an id field in the
//   // 201 response (or a Location header). We try the response body first.
//   const created = mapRestRecordToCustomer(raw);

//   log.info({ internalId: created.internalId }, "Customer created");
//   return created;
// }

// /**
//  * Update an existing customer record in NetSuite via PATCH.
//  */
// export async function updateCustomer(
//   client,
//   internalId,
//   customer,
// ) {
//   log.info({ internalId }, "Updating customer");

//   const body = buildCustomerBody(customer);

//   const raw = await client.patch(
//     `/customer/${internalId}`,
//     body,
//   );

//   const updated = mapRestRecordToCustomer(raw);

//   log.info({ internalId: updated.internalId }, "Customer updated");
//   return updated;
// }

// /**
//  * Find a customer by email address via the search RESTlet.
//  *
//  * Returns `null` when no match is found.
//  */
// export async function findCustomerByEmail(
//   client,
//   email,
// ) {
//   log.debug({ email }, "Searching for customer by email");

//   const response = await client.callRestlet(
//     RESTLET_SCRIPT_ID,
//     RESTLET_DEPLOY_ID,
//     {
//       operation: "search",
//       filters: [["email", "is", email]],
//       pageSize: 1,
//       offset: 0,
//     },
//   );

//   if (!response.success) {
//     throw new NetSuiteError(
//       `Customer email search failed: ${response.error?.message ?? "unknown error"}`,
//       response.error?.code,
//     );
//   }

//   const results = response.data ?? [];
//   if (results.length === 0) {
//     log.debug({ email }, "No customer found for email");
//     return null;
//   }

//   return results[0];
// }

// // ---------------------------------------------------------------------------
// // Mapping helpers
// // ---------------------------------------------------------------------------

// /**
//  * Map a raw REST Records API JSON response to our canonical
//  * `NetSuiteCustomer` type.
//  */
// function mapRestRecordToCustomer(raw) {
//   const addressBook = raw.addressBook;

//   const addresses = (addressBook?.items ?? []).map((a) => ({
//     internalId: a.internalId != null ? String(a.internalId) : undefined,
//     addr1: a.addr1 != null ? String(a.addr1) : undefined,
//     addr2: a.addr2 != null ? String(a.addr2) : undefined,
//     city: a.city != null ? String(a.city) : undefined,
//     state: a.state != null ? String(a.state) : undefined,
//     zip: a.zip != null ? String(a.zip) : undefined,
//     country: a.country != null ? String(a.country) : undefined,
//     isDefaultBilling: a.defaultBilling === true || a.defaultBilling === "T",
//     isDefaultShipping: a.defaultShipping === true || a.defaultShipping === "T",
//   }));

//   const defaultAddress =
//     addresses.find((a) => a.isDefaultShipping) ??
//     addresses.find((a) => a.isDefaultBilling) ??
//     (addresses.length > 0 ? addresses[0] : undefined);

//   return {
//     internalId: String(raw.id ?? ""),
//     entityId: String(raw.entityId ?? ""),
//     companyName: raw.companyName != null ? String(raw.companyName) : undefined,
//     firstName: raw.firstName != null ? String(raw.firstName) : undefined,
//     lastName: raw.lastName != null ? String(raw.lastName) : undefined,
//     email: String(raw.email ?? ""),
//     phone: raw.phone != null ? String(raw.phone) : undefined,
//     defaultAddress,
//     addresses,
//     isPerson: raw.isPerson === true || raw.isPerson === "T",
//     isActive: raw.isInactive === false || raw.isInactive === "F",
//     lastModifiedDate: String(raw.lastModifiedDate ?? ""),
//     customFields: raw.custentity ?? undefined,
//   };
// }

// /**
//  * Build a REST Records API-compatible JSON body from a `CustomerInput`.
//  */
// function buildCustomerBody(
//   customer,
// ) {
//   const body = {};

//   if (customer.entityId !== undefined) body.entityId = customer.entityId;
//   if (customer.companyName !== undefined) body.companyName = customer.companyName;
//   if (customer.firstName !== undefined) body.firstName = customer.firstName;
//   if (customer.lastName !== undefined) body.lastName = customer.lastName;
//   if (customer.email !== undefined) body.email = customer.email;
//   if (customer.phone !== undefined) body.phone = customer.phone;
//   if (customer.isPerson !== undefined) body.isPerson = customer.isPerson;

//   // Map addresses into the addressBook subrecord.
//   if (customer.addresses && customer.addresses.length > 0) {
//     body.addressBook = {
//       items: customer.addresses.map((addr) => ({
//         addr1: addr.addr1,
//         addr2: addr.addr2,
//         city: addr.city,
//         state: addr.state,
//         zip: addr.zip,
//         country: addr.country,
//         defaultBilling: addr.isDefaultBilling ?? false,
//         defaultShipping: addr.isDefaultShipping ?? false,
//       })),
//     };
//   }

//   // Pass through any custom fields.
//   if (customer.customFields) {
//     for (const [key, value] of Object.entries(customer.customFields)) {
//       body[key] = value;
//     }
//   }

//   return body;
// }
