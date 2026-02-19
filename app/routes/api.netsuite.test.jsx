import { authenticate } from "../shopify.server";
import { getNetSuiteConfig, updateTestResult } from "../models/netsuite-config.model";
import { createServiceLogger } from "../services/common/logger";

const log = createServiceLogger("netsuite-test");

export async function action({ request }) {
  await authenticate.admin(request);

  try {
    const config = await getNetSuiteConfig();

    if (!config) {
      return new Response(
        JSON.stringify({ success: false, error: "NetSuite configuration not found" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { createNetSuiteClient } = await import(
      "../services/netsuite/netsuite.client"
    );

    const client = await createNetSuiteClient();

    // Test REST API connectivity
    await client.get("/record/v1/customer?limit=1");

    await updateTestResult(config.id, "success");

    log.info("NetSuite connection test succeeded");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Successfully connected to NetSuite",
        accountId: config.accountId,
        testedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Connection failed";

    log.error({ error: errorMessage }, "NetSuite connection test failed");

    const config = await getNetSuiteConfig();
    if (config) {
      await updateTestResult(config.id, "failed");
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        testedAt: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
