/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * RESTlet: Customer Sync
 *
 * Multi-operation RESTlet supporting search, get, create, and update of
 * customer records.
 *
 * POST body shape:
 *   {
 *     operation: "search" | "get" | "create" | "update",
 *     filters?: Array,       // for search
 *     pageSize?: number,     // for search
 *     offset?: number,       // for search
 *     id?: string,           // for get / update
 *     data?: Object          // for create / update
 *   }
 *
 * Response shape:
 *   { success: boolean, data: ..., count?: number, hasMore?: boolean, error?: { code, message } }
 */
define(["N/search", "N/record", "N/log"], (search, record, log) => {
  "use strict";

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  const MAX_PAGE_SIZE = 1000;
  const DEFAULT_PAGE_SIZE = 25;

  const CUSTOMER_COLUMNS = [
    "internalid",
    "entityid",
    "companyname",
    "firstname",
    "lastname",
    "email",
    "phone",
    "isperson",
    "isinactive",
    "lastmodifieddate",
  ];

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function mapOperator(op) {
    const map = {
      is: search.Operator.IS,
      isnot: search.Operator.ISNOT,
      contains: search.Operator.CONTAINS,
      startswith: search.Operator.STARTSWITH,
      onorafter: search.Operator.ONORAFTER,
      onorbefore: search.Operator.ONORBEFORE,
      anyof: search.Operator.ANYOF,
      greaterthan: search.Operator.GREATERTHAN,
      lessthan: search.Operator.LESSTHAN,
    };
    const normalised = String(op).toLowerCase().replace(/[_\s]/g, "");
    return map[normalised] || op;
  }

  function buildFilters(rawFilters) {
    if (!Array.isArray(rawFilters) || rawFilters.length === 0) {
      return [];
    }
    const filters = [];
    for (const entry of rawFilters) {
      if (typeof entry === "string") {
        filters.push(entry);
      } else if (Array.isArray(entry) && entry.length >= 3) {
        filters.push(
          search.createFilter({
            name: entry[0],
            operator: mapOperator(entry[1]),
            values: Array.isArray(entry[2]) ? entry[2] : [entry[2]],
          })
        );
      }
    }
    return filters;
  }

  function getValue(result, name) {
    try {
      return result.getValue({ name: name });
    } catch (_e) {
      return null;
    }
  }

  function getText(result, name) {
    try {
      return result.getText({ name: name }) || getValue(result, name);
    } catch (_e) {
      return getValue(result, name);
    }
  }

  /**
   * Map a search result row to the canonical customer shape.
   */
  function mapSearchResult(result) {
    return {
      internalId: getValue(result, "internalid"),
      entityId: getValue(result, "entityid"),
      companyName: getValue(result, "companyname") || null,
      firstName: getValue(result, "firstname") || null,
      lastName: getValue(result, "lastname") || null,
      email: getValue(result, "email") || "",
      phone: getValue(result, "phone") || null,
      isPerson: getValue(result, "isperson") === "T",
      isActive: getValue(result, "isinactive") !== "T",
      lastModifiedDate: getValue(result, "lastmodifieddate"),
    };
  }

  /**
   * Load a customer record and return the canonical shape (including
   * address subrecords).
   */
  function loadCustomerRecord(customerId) {
    const rec = record.load({
      type: record.Type.CUSTOMER,
      id: customerId,
      isDynamic: false,
    });

    const addresses = [];
    const addressCount = rec.getLineCount({ sublistId: "addressbook" });
    for (let i = 0; i < addressCount; i++) {
      const addrSubrecord = rec.getSublistSubrecord({
        sublistId: "addressbook",
        fieldId: "addressbookaddress",
        line: i,
      });
      addresses.push({
        internalId: rec.getSublistValue({ sublistId: "addressbook", fieldId: "id", line: i }) || null,
        addr1: addrSubrecord.getValue({ fieldId: "addr1" }) || null,
        addr2: addrSubrecord.getValue({ fieldId: "addr2" }) || null,
        city: addrSubrecord.getValue({ fieldId: "city" }) || null,
        state: addrSubrecord.getValue({ fieldId: "state" }) || null,
        zip: addrSubrecord.getValue({ fieldId: "zip" }) || null,
        country: addrSubrecord.getValue({ fieldId: "country" }) || null,
        isDefaultBilling:
          rec.getSublistValue({ sublistId: "addressbook", fieldId: "defaultbilling", line: i }) === true,
        isDefaultShipping:
          rec.getSublistValue({ sublistId: "addressbook", fieldId: "defaultshipping", line: i }) === true,
      });
    }

    return {
      internalId: String(rec.id),
      entityId: rec.getValue({ fieldId: "entityid" }) || "",
      companyName: rec.getValue({ fieldId: "companyname" }) || null,
      firstName: rec.getValue({ fieldId: "firstname" }) || null,
      lastName: rec.getValue({ fieldId: "lastname" }) || null,
      email: rec.getValue({ fieldId: "email" }) || "",
      phone: rec.getValue({ fieldId: "phone" }) || null,
      addresses: addresses,
      isPerson: rec.getValue({ fieldId: "isperson" }) === "T",
      isActive: rec.getValue({ fieldId: "isinactive" }) !== "T",
      lastModifiedDate: rec.getValue({ fieldId: "lastmodifieddate" }),
    };
  }

  // -----------------------------------------------------------------------
  // Operations
  // -----------------------------------------------------------------------

  /**
   * Search for customers with optional filters and pagination.
   */
  function handleSearch(body) {
    const pageSize = Math.min(
      parseInt(body.pageSize, 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    const offset = parseInt(body.offset, 10) || 0;
    const filters = buildFilters(body.filters);

    const columns = CUSTOMER_COLUMNS.map((col) =>
      search.createColumn({ name: col })
    );

    const customerSearch = search.create({
      type: search.Type.CUSTOMER,
      filters: filters,
      columns: columns,
    });

    const pagedData = customerSearch.runPaged({ pageSize: pageSize });
    const totalCount = pagedData.count;

    const startPage = Math.floor(offset / pageSize);
    const offsetInPage = offset % pageSize;

    const items = [];
    let remaining = pageSize;

    for (
      let pageIdx = startPage;
      pageIdx < pagedData.pageRanges.length && remaining > 0;
      pageIdx++
    ) {
      const page = pagedData.fetch({ index: pageIdx });
      const results = page.data;

      const startIdx = pageIdx === startPage ? offsetInPage : 0;
      for (let i = startIdx; i < results.length && remaining > 0; i++) {
        items.push(mapSearchResult(results[i]));
        remaining--;
      }
    }

    const hasMore = offset + items.length < totalCount;

    return {
      success: true,
      data: items,
      count: totalCount,
      hasMore: hasMore,
    };
  }

  /**
   * Get a single customer by internal ID (full record with addresses).
   */
  function handleGet(body) {
    if (!body.id) {
      return {
        success: false,
        error: { code: "MISSING_ID", message: "id is required for get operation" },
      };
    }

    const customer = loadCustomerRecord(body.id);
    return { success: true, data: customer };
  }

  /**
   * Create a new customer record.
   */
  function handleCreate(body) {
    const data = body.data;
    if (!data) {
      return {
        success: false,
        error: { code: "MISSING_DATA", message: "data is required for create operation" },
      };
    }

    const rec = record.create({
      type: record.Type.CUSTOMER,
      isDynamic: true,
    });

    // Standard fields.
    if (data.isPerson !== undefined) rec.setValue({ fieldId: "isperson", value: data.isPerson ? "T" : "F" });
    if (data.entityId) rec.setValue({ fieldId: "entityid", value: data.entityId });
    if (data.companyName) rec.setValue({ fieldId: "companyname", value: data.companyName });
    if (data.firstName) rec.setValue({ fieldId: "firstname", value: data.firstName });
    if (data.lastName) rec.setValue({ fieldId: "lastname", value: data.lastName });
    if (data.email) rec.setValue({ fieldId: "email", value: data.email });
    if (data.phone) rec.setValue({ fieldId: "phone", value: data.phone });

    // Custom fields (custentity_*).
    if (data.customFields && typeof data.customFields === "object") {
      for (const [fieldId, value] of Object.entries(data.customFields)) {
        try {
          rec.setValue({ fieldId: fieldId, value: value });
        } catch (e) {
          log.debug("Skipping custom field " + fieldId, e.message);
        }
      }
    }

    // Addresses.
    if (Array.isArray(data.addresses)) {
      for (const addr of data.addresses) {
        rec.selectNewLine({ sublistId: "addressbook" });
        if (addr.isDefaultBilling) rec.setCurrentSublistValue({ sublistId: "addressbook", fieldId: "defaultbilling", value: true });
        if (addr.isDefaultShipping) rec.setCurrentSublistValue({ sublistId: "addressbook", fieldId: "defaultshipping", value: true });

        const addrSubrecord = rec.getCurrentSublistSubrecord({
          sublistId: "addressbook",
          fieldId: "addressbookaddress",
        });
        if (addr.addr1) addrSubrecord.setValue({ fieldId: "addr1", value: addr.addr1 });
        if (addr.addr2) addrSubrecord.setValue({ fieldId: "addr2", value: addr.addr2 });
        if (addr.city) addrSubrecord.setValue({ fieldId: "city", value: addr.city });
        if (addr.state) addrSubrecord.setValue({ fieldId: "state", value: addr.state });
        if (addr.zip) addrSubrecord.setValue({ fieldId: "zip", value: addr.zip });
        if (addr.country) addrSubrecord.setValue({ fieldId: "country", value: addr.country });

        rec.commitLine({ sublistId: "addressbook" });
      }
    }

    const customerId = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });

    log.audit("Customer created", { internalId: customerId });

    return {
      success: true,
      data: { internalId: String(customerId) },
    };
  }

  /**
   * Update an existing customer record.
   */
  function handleUpdate(body) {
    if (!body.id) {
      return {
        success: false,
        error: { code: "MISSING_ID", message: "id is required for update operation" },
      };
    }
    const data = body.data;
    if (!data) {
      return {
        success: false,
        error: { code: "MISSING_DATA", message: "data is required for update operation" },
      };
    }

    const rec = record.load({
      type: record.Type.CUSTOMER,
      id: body.id,
      isDynamic: true,
    });

    if (data.companyName !== undefined) rec.setValue({ fieldId: "companyname", value: data.companyName });
    if (data.firstName !== undefined) rec.setValue({ fieldId: "firstname", value: data.firstName });
    if (data.lastName !== undefined) rec.setValue({ fieldId: "lastname", value: data.lastName });
    if (data.email !== undefined) rec.setValue({ fieldId: "email", value: data.email });
    if (data.phone !== undefined) rec.setValue({ fieldId: "phone", value: data.phone });

    // Custom fields.
    if (data.customFields && typeof data.customFields === "object") {
      for (const [fieldId, value] of Object.entries(data.customFields)) {
        try {
          rec.setValue({ fieldId: fieldId, value: value });
        } catch (e) {
          log.debug("Skipping custom field " + fieldId, e.message);
        }
      }
    }

    const savedId = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });

    log.audit("Customer updated", { internalId: savedId });

    return {
      success: true,
      data: { internalId: String(savedId) },
    };
  }

  // -----------------------------------------------------------------------
  // RESTlet entry point
  // -----------------------------------------------------------------------

  function post(requestBody) {
    try {
      const operation = requestBody.operation;

      log.debug("Customer sync RESTlet called", { operation: operation });

      switch (operation) {
        case "search":
          return handleSearch(requestBody);
        case "get":
          return handleGet(requestBody);
        case "create":
          return handleCreate(requestBody);
        case "update":
          return handleUpdate(requestBody);
        default:
          return {
            success: false,
            error: {
              code: "INVALID_OPERATION",
              message:
                'Unsupported operation "' +
                operation +
                '". Use search, get, create, or update.',
            },
          };
      }
    } catch (e) {
      log.error("Customer sync RESTlet failed", {
        error: e.message,
        stack: e.stack,
      });

      return {
        success: false,
        error: {
          code: e.name || "UNEXPECTED_ERROR",
          message: e.message,
        },
      };
    }
  }

  return { post: post };
});
