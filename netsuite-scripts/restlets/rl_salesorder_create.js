/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * RESTlet: Sales Order Create / Search
 *
 * Supports two operations via POST:
 *
 *   operation: "create"
 *     - Creates a sales order from the supplied data.
 *     - Returns { success, internalId, tranId }
 *
 *   operation: "search"
 *     - Searches sales orders using the supplied filters (e.g. Shopify order ID).
 *     - Returns { success, data: [...], count, hasMore }
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  "use strict";

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function mapOperator(op) {
    const map = {
      is: search.Operator.IS,
      isnot: search.Operator.ISNOT,
      contains: search.Operator.CONTAINS,
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

  /**
   * Set an address subrecord on the sales order.
   *
   * @param {Record} rec        - The sales order record.
   * @param {string} fieldId    - "shippingaddress" or "billingaddress".
   * @param {Object} addrData   - Address payload from the caller.
   */
  function setAddress(rec, fieldId, addrData) {
    if (!addrData) return;

    const subrecord = rec.getSubrecord({ fieldId: fieldId });
    if (addrData.addr1) subrecord.setValue({ fieldId: "addr1", value: addrData.addr1 });
    if (addrData.addr2) subrecord.setValue({ fieldId: "addr2", value: addrData.addr2 });
    if (addrData.city) subrecord.setValue({ fieldId: "city", value: addrData.city });
    if (addrData.state) subrecord.setValue({ fieldId: "state", value: addrData.state });
    if (addrData.zip) subrecord.setValue({ fieldId: "zip", value: addrData.zip });
    if (addrData.country) subrecord.setValue({ fieldId: "country", value: addrData.country });
  }

  // -----------------------------------------------------------------------
  // Operations
  // -----------------------------------------------------------------------

  function handleCreate(body) {
    const data = body.data || body;

    if (!data.entity) {
      return {
        success: false,
        error: { code: "MISSING_ENTITY", message: "entity (customer internalId) is required" },
      };
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        success: false,
        error: { code: "MISSING_ITEMS", message: "At least one line item is required" },
      };
    }

    const rec = record.create({
      type: record.Type.SALES_ORDER,
      isDynamic: true,
    });

    // Header fields.
    rec.setValue({ fieldId: "entity", value: data.entity });

    if (data.tranDate) {
      rec.setValue({ fieldId: "trandate", value: new Date(data.tranDate) });
    }
    if (data.memo) {
      rec.setValue({ fieldId: "memo", value: data.memo });
    }

    // Custom body fields (e.g. custbody_shopify_order_id).
    if (data.customFields && typeof data.customFields === "object") {
      for (const [fieldId, value] of Object.entries(data.customFields)) {
        try {
          rec.setValue({ fieldId: fieldId, value: value });
        } catch (e) {
          log.debug("Skipping custom field " + fieldId, e.message);
        }
      }
    }

    // Line items.
    for (const lineItem of data.items) {
      rec.selectNewLine({ sublistId: "item" });
      rec.setCurrentSublistValue({ sublistId: "item", fieldId: "item", value: lineItem.item });
      rec.setCurrentSublistValue({ sublistId: "item", fieldId: "quantity", value: lineItem.quantity });
      rec.setCurrentSublistValue({ sublistId: "item", fieldId: "rate", value: lineItem.rate });

      if (lineItem.amount !== undefined) {
        rec.setCurrentSublistValue({ sublistId: "item", fieldId: "amount", value: lineItem.amount });
      }
      if (lineItem.description) {
        rec.setCurrentSublistValue({ sublistId: "item", fieldId: "description", value: lineItem.description });
      }
      if (lineItem.taxCode) {
        rec.setCurrentSublistValue({ sublistId: "item", fieldId: "taxcode", value: lineItem.taxCode });
      }

      rec.commitLine({ sublistId: "item" });
    }

    // Addresses.
    setAddress(rec, "shippingaddress", data.shippingAddress);
    setAddress(rec, "billingaddress", data.billingAddress);

    // Shipping cost / discount.
    if (data.shippingCost !== undefined) {
      rec.setValue({ fieldId: "shippingcost", value: data.shippingCost });
    }
    if (data.discountTotal !== undefined) {
      rec.setValue({ fieldId: "discounttotal", value: data.discountTotal });
    }

    const salesOrderId = rec.save({
      enableSourcing: true,
      ignoreMandatoryFields: false,
    });

    // Read back the tranId from the saved record.
    const savedRecord = record.load({
      type: record.Type.SALES_ORDER,
      id: salesOrderId,
    });
    const tranId = savedRecord.getValue({ fieldId: "tranid" }) || "";

    log.audit("Sales order created", {
      internalId: salesOrderId,
      tranId: tranId,
    });

    return {
      success: true,
      internalId: String(salesOrderId),
      tranId: String(tranId),
    };
  }

  function handleSearch(body) {
    const pageSize = Math.min(
      parseInt(body.pageSize, 10) || 20,
      1000
    );
    const offset = parseInt(body.offset, 10) || 0;
    const filters = buildFilters(body.filters);

    const columns = [
      search.createColumn({ name: "internalid" }),
      search.createColumn({ name: "tranid" }),
      search.createColumn({ name: "entity" }),
      search.createColumn({ name: "status" }),
      search.createColumn({ name: "total" }),
      search.createColumn({ name: "custbody_shopify_order_id" }),
    ];

    const orderSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: filters,
      columns: columns,
    });

    const pagedData = orderSearch.runPaged({ pageSize: pageSize });
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
        const r = results[i];
        items.push({
          internalId: r.getValue({ name: "internalid" }),
          tranId: r.getValue({ name: "tranid" }),
          entity: r.getText({ name: "entity" }) || r.getValue({ name: "entity" }),
          status: r.getText({ name: "status" }) || r.getValue({ name: "status" }),
          total: parseFloat(r.getValue({ name: "total" })) || 0,
          shopifyOrderId: r.getValue({ name: "custbody_shopify_order_id" }) || null,
        });
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

  // -----------------------------------------------------------------------
  // RESTlet entry point
  // -----------------------------------------------------------------------

  function post(requestBody) {
    try {
      const operation = requestBody.operation || "create";

      log.debug("Sales order RESTlet called", { operation: operation });

      switch (operation) {
        case "create":
          return handleCreate(requestBody);
        case "search":
          return handleSearch(requestBody);
        default:
          return {
            success: false,
            error: {
              code: "INVALID_OPERATION",
              message:
                'Unsupported operation "' +
                operation +
                '". Use create or search.',
            },
          };
      }
    } catch (e) {
      log.error("Sales order RESTlet failed", {
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
