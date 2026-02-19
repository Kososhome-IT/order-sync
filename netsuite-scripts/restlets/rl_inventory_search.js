/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * RESTlet: Inventory Item Search
 *
 * Accepts a POST with { filters, columns, pageSize, offset } and returns a
 * paginated list of inventory items.
 *
 * Response shape:
 *   { success: boolean, data: items[], count: number, hasMore: boolean }
 */
define(["N/search", "N/log"], (search, log) => {
  "use strict";

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  const MAX_PAGE_SIZE = 1000;
  const DEFAULT_PAGE_SIZE = 50;

  /** Columns to return when the caller does not specify any. */
  const DEFAULT_COLUMNS = [
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
  ];

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Convert the caller-supplied filter array into N/search.createFilter
   * objects.
   *
   * Supported formats:
   *   ["fieldId", "operator", "value"]          - single filter
   *   "AND" / "OR"                              - logical junction
   */
  function buildFilters(rawFilters) {
    if (!Array.isArray(rawFilters) || rawFilters.length === 0) {
      return [];
    }

    const filters = [];
    for (const entry of rawFilters) {
      if (typeof entry === "string") {
        // Logical operator token ("AND" / "OR") is kept as-is.
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
   * Map human-readable operator strings to N/search operator enum values.
   */
  function mapOperator(op) {
    const map = {
      is: search.Operator.IS,
      isnot: search.Operator.ISNOT,
      contains: search.Operator.CONTAINS,
      doesnotcontain: search.Operator.DOESNOTCONTAIN,
      startswith: search.Operator.STARTSWITH,
      greaterthan: search.Operator.GREATERTHAN,
      lessthan: search.Operator.LESSTHAN,
      greaterthanorequalto: search.Operator.GREATERTHANOREQUALTO,
      lessthanorequalto: search.Operator.LESSTHANOREQUALTO,
      onorafter: search.Operator.ONORAFTER,
      onorbefore: search.Operator.ONORBEFORE,
      within: search.Operator.WITHIN,
      anyof: search.Operator.ANYOF,
      noneOf: search.Operator.NONEOF,
    };
    const normalised = String(op).toLowerCase().replace(/[_\s]/g, "");
    return map[normalised] || op;
  }

  /**
   * Build N/search.Column objects from the caller-supplied column list.
   */
  function buildColumns(rawColumns) {
    const cols =
      Array.isArray(rawColumns) && rawColumns.length > 0
        ? rawColumns
        : DEFAULT_COLUMNS;

    return cols.map((col) => {
      if (typeof col === "string") {
        return search.createColumn({ name: col });
      }
      // Allow { name, join?, summary? } objects.
      return search.createColumn({
        name: col.name,
        join: col.join || null,
        summary: col.summary || null,
      });
    });
  }

  /**
   * Extract scalar value from a search result column.
   */
  function getValue(result, colName) {
    try {
      return result.getValue({ name: colName });
    } catch (_e) {
      return null;
    }
  }

  function getText(result, colName) {
    try {
      return result.getText({ name: colName }) || getValue(result, colName);
    } catch (_e) {
      return getValue(result, colName);
    }
  }

  /**
   * Map a single search result row to the canonical inventory item shape
   * expected by the TypeScript client.
   */
  function mapResult(result) {
    return {
      internalId: getValue(result, "internalid"),
      itemId: getValue(result, "itemid"),
      displayName: getText(result, "displayname") || getValue(result, "itemid"),
      description: getValue(result, "description") || null,
      sku: getValue(result, "itemid"),
      upcCode: getValue(result, "upccode") || null,
      quantityAvailable: parseFloat(getValue(result, "quantityavailable")) || 0,
      quantityOnHand: parseFloat(getValue(result, "quantityonhand")) || 0,
      quantityOnOrder: parseFloat(getValue(result, "quantityonorder")) || 0,
      basePrice: parseFloat(getValue(result, "baseprice")) || null,
      lastModifiedDate: getValue(result, "lastmodifieddate"),
      isActive: getValue(result, "isinactive") !== "T",
    };
  }

  // -----------------------------------------------------------------------
  // RESTlet entry point
  // -----------------------------------------------------------------------

  /**
   * POST handler.
   *
   * @param {Object} requestBody
   * @param {Array}  requestBody.filters   - Search filters.
   * @param {Array}  requestBody.columns   - Columns to return.
   * @param {number} requestBody.pageSize  - Results per page.
   * @param {number} requestBody.offset    - Starting offset.
   * @returns {{ success: boolean, data: Object[], count: number, hasMore: boolean }}
   */
  function post(requestBody) {
    try {
      const pageSize = Math.min(
        parseInt(requestBody.pageSize, 10) || DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE
      );
      const offset = parseInt(requestBody.offset, 10) || 0;

      const filters = buildFilters(requestBody.filters);
      const columns = buildColumns(requestBody.columns);

      const inventorySearch = search.create({
        type: search.Type.INVENTORY_ITEM,
        filters: filters,
        columns: columns,
      });

      // Use runPaged for efficient pagination.
      const pagedData = inventorySearch.runPaged({ pageSize: pageSize });
      const totalCount = pagedData.count;

      // Calculate which page(s) we need based on offset.
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
          items.push(mapResult(results[i]));
          remaining--;
        }
      }

      const hasMore = offset + items.length < totalCount;

      log.audit("Inventory search completed", {
        totalCount: totalCount,
        returned: items.length,
        offset: offset,
        hasMore: hasMore,
      });

      return {
        success: true,
        data: items,
        count: totalCount,
        hasMore: hasMore,
      };
    } catch (e) {
      log.error("Inventory search failed", {
        error: e.message,
        stack: e.stack,
      });

      return {
        success: false,
        data: [],
        count: 0,
        hasMore: false,
        error: {
          code: e.name || "SEARCH_ERROR",
          message: e.message,
        },
      };
    }
  }

  return { post: post };
});
