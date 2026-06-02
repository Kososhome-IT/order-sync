import { createServiceLogger } from "../services/common/logger";
import { hashRecord } from "../utils/crypto";

const log = createServiceLogger("conflict-resolver");

export function checkForConflict(
  mapping,
  currentShopifyRecord,
  currentNetsuiteRecord,
) {
  const currentShopifyHash = hashRecord(currentShopifyRecord);
  const currentNetsuiteHash = hashRecord(currentNetsuiteRecord);

  const shopifyChanged = mapping.shopifyHash !== currentShopifyHash;
  const netsuiteChanged = mapping.netsuiteHash !== currentNetsuiteHash;

  return {
    hasConflict: shopifyChanged && netsuiteChanged,
    shopifyChanged,
    netsuiteChanged,
  };
}

export function resolveConflict(
  shopifyRecord,
  netsuiteRecord,
  strategy,
) {
  switch (strategy) {
    case "last_write_wins": {
      const shopifyDate = shopifyRecord.updatedAt ? new Date(shopifyRecord.updatedAt) : new Date(0);
      const netsuiteDate = netsuiteRecord.lastModifiedDate
        ? new Date(netsuiteRecord.lastModifiedDate)
        : new Date(0);

      if (shopifyDate > netsuiteDate) {
        log.info("Conflict resolved: Shopify wins (last write wins)");
        return {
          winner: "shopify",
          requiresManualResolution: false,
          reason: `Shopify record updated more recently (${shopifyDate.toISOString()} > ${netsuiteDate.toISOString()})`,
        };
      } else {
        log.info("Conflict resolved: NetSuite wins (last write wins)");
        return {
          winner: "netsuite",
          requiresManualResolution: false,
          reason: `NetSuite record updated more recently (${netsuiteDate.toISOString()} >= ${shopifyDate.toISOString()})`,
        };
      }
    }

    case "netsuite_wins":
      return {
        winner: "netsuite",
        requiresManualResolution: false,
        reason: "Strategy: NetSuite always wins",
      };

    case "shopify_wins":
      return {
        winner: "shopify",
        requiresManualResolution: false,
        reason: "Strategy: Shopify always wins",
      };

    case "manual":
      log.info("Conflict requires manual resolution");
      return {
        winner: null,
        requiresManualResolution: true,
        reason: "Strategy: Manual resolution required",
      };

    default:
      return {
        winner: "netsuite",
        requiresManualResolution: false,
        reason: "Default: NetSuite wins on unknown strategy",
      };
  }
}
