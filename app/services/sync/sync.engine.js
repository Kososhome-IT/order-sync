import { v4 as uuidv4 } from "uuid";
import { createServiceLogger } from "../common/logger";
import * as syncStateModel from "../../models/sync-state.model"; // /models/sync-state.model

const log = createServiceLogger("sync-engine");

export class SyncEngine {
  async triggerSync(
    entityType,
    mode = "delta",
    triggeredBy = "manual",
  ) {
    const syncState = await syncStateModel.getSyncState(entityType);

    if (!syncState) {
      throw new Error(`No sync state found for entity type: ${entityType}`);
    }

    if (!syncState.isEnabled && triggeredBy !== "manual") {
      throw new Error(`Sync is disabled for ${entityType}`);
    }

    if (syncState.status === "running") {
      throw new Error(`Sync is already running for ${entityType}`);
    }

    if (syncState.status === "paused" && triggeredBy !== "manual") {
      throw new Error(`Sync is paused for ${entityType} due to error threshold`);
    }

    const jobData = {
      syncRunId: uuidv4(),
      entityType,
      direction: entityType === "order" ? "shopify_to_ns" : "ns_to_shopify",
      mode,
      triggeredBy,
    };

    log.info(jobData, `Triggering ${entityType} sync`);

    return jobData;
  }

  async getSyncStatus() {
    const states = await syncStateModel.getAllSyncStates();

    const statusMap = {};
    for (const state of states) {
      statusMap[state.entityType] = {
        entityType: state.entityType,
        status: state.status,
        isEnabled: state.isEnabled,
        lastSyncAt: state.lastSyncAt?.toISOString() || null,
        lastSuccessfulSyncAt: state.lastSuccessfulSyncAt?.toISOString() || null,
        nextSyncAt: state.nextSyncAt?.toISOString() || null,
        recordsSynced: state.recordsSynced,
        recordsFailed: state.recordsFailed,
        errorCount24h: state.errorCount24h,
        cronExpression: state.cronExpression,
      };
    }

    return {
      inventory: statusMap["inventory"] || createDefaultStatus("inventory"),
      order: statusMap["order"] || createDefaultStatus("order"),
      customer: statusMap["customer"] || createDefaultStatus("customer"),
    };
  }

  async pauseSync(entityType) {
    await syncStateModel.updateSyncState(entityType, { status: "paused" });
    log.info({ entityType }, "Sync paused");
  }

  async resumeSync(entityType) {
    await syncStateModel.updateSyncState(entityType, {
      status: "idle",
      errorCount24h: 0,
    });
    log.info({ entityType }, "Sync resumed");
  }

  async updateSchedule(
    entityType,
    cronExpression,
    isEnabled,
  ) {
    await syncStateModel.updateSyncState(entityType, {
      cronExpression,
      isEnabled,
    });
    log.info({ entityType, cronExpression, isEnabled }, "Sync schedule updated");
  }
}

function createDefaultStatus(entityType) {
  return {
    entityType,
    status: "idle",
    isEnabled: false,
    lastSyncAt: null,
    lastSuccessfulSyncAt: null,
    nextSyncAt: null,
    recordsSynced: 0,
    recordsFailed: 0,
    errorCount24h: 0,
    cronExpression: "*/15 * * * *",
  };
}

export const syncEngine = new SyncEngine();
