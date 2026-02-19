import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Spinner,
  BlockStack,
  InlineStack,
  Text,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { syncEngine } from "../services/sync/sync.engine";

export async function loader({ request }) {
  await authenticate.admin(request);
  const status = await syncEngine.getSyncStatus();
  return json({ status });
}

export default function SyncControls() {
  const { status } = useLoaderData();
  const [syncingEntities, setSyncingEntities] = useState({});
  const [results, setResults] = useState({});

  const triggerSync = useCallback(async (entityType, mode) => {
    setSyncingEntities((prev) => ({ ...prev, [entityType]: mode }));
    setResults((prev) => {
      const next = { ...prev };
      delete next[entityType];
      return next;
    });

    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, mode }),
      });
      const data = await res.json();

      setResults((prev) => ({
        ...prev,
        [entityType]: {
          success: !!data.success,
          message: data.success
            ? `${mode === "full" ? "Full" : "Delta"} sync triggered (Run ID: ${data.syncRunId?.substring(0, 8)}...)`
            : data.error || "Failed to trigger sync",
        },
      }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [entityType]: { success: false, message: "Failed to trigger sync" },
      }));
    } finally {
      setSyncingEntities((prev) => {
        const next = { ...prev };
        delete next[entityType];
        return next;
      });
    }
  }, []);

  const triggerAll = useCallback(async () => {
    await Promise.all([
      triggerSync("inventory", "delta"),
      triggerSync("order", "delta"),
      triggerSync("customer", "delta"),
    ]);
  }, [triggerSync]);

  const handlePause = useCallback(async (entityType) => {
    await fetch("/api/sync/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _action: "pause", entityType }),
    });
    window.location.reload();
  }, []);

  const handleResume = useCallback(async (entityType) => {
    await fetch("/api/sync/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _action: "resume", entityType }),
    });
    window.location.reload();
  }, []);

  const entities = [
    { type: "inventory", label: "Inventory", direction: "NetSuite \u2192 Shopify" },
    { type: "order", label: "Orders", direction: "Shopify \u2192 NetSuite" },
    { type: "customer", label: "Customers", direction: "Bidirectional" },
  ];

  const statusTone = (s) => {
    const map = {
      idle: "success",
      running: "info",
      paused: "warning",
      failed: "critical",
    };
    return map[s] || "info";
  };

  return (
    <Page title="Manual Sync Controls" backAction={{ url: "/app" }}>
      <BlockStack gap="400">
        <Banner>
          <p>Manual syncs are processed in the background. Large datasets may take several minutes to complete.</p>
        </Banner>

        <InlineStack align="end">
          <Button variant="primary" onClick={triggerAll}>Sync All (Delta)</Button>
        </InlineStack>

        <Layout>
          {entities.map(({ type, label, direction }) => {
            const s = status[type];
            const isSyncing = !!syncingEntities[type];
            const result = results[type];

            return (
              <Layout.Section key={type}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <BlockStack gap="100">
                        <Text variant="headingMd" as="h2">{label} Sync</Text>
                        <Text as="span" tone="subdued">{direction}</Text>
                      </BlockStack>
                      <Badge tone={statusTone(s.status)}>{s.status.toUpperCase()}</Badge>
                    </InlineStack>

                    <InlineStack gap="400">
                      <BlockStack gap="050">
                        <Text as="span" tone="subdued">Last sync</Text>
                        <Text as="span">{s.lastSuccessfulSyncAt ? new Date(s.lastSuccessfulSyncAt).toLocaleString() : "Never"}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" tone="subdued">Records synced</Text>
                        <Text as="span">{s.recordsSynced}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" tone="subdued">Failed</Text>
                        <Text as="span" tone={s.recordsFailed > 0 ? "critical" : undefined}>{s.recordsFailed}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" tone="subdued">Errors (24h)</Text>
                        <Text as="span" tone={s.errorCount24h > 0 ? "critical" : undefined}>{s.errorCount24h}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" tone="subdued">Schedule</Text>
                        <Text as="span">{s.cronExpression}</Text>
                      </BlockStack>
                    </InlineStack>

                    {isSyncing && (
                      <InlineStack gap="200" blockAlign="center">
                        <Spinner size="small" />
                        <Text as="span">Running {syncingEntities[type]} sync...</Text>
                      </InlineStack>
                    )}

                    {result && (
                      <Banner tone={result.success ? "success" : "critical"} onDismiss={() => setResults((prev) => {
                        const next = { ...prev };
                        delete next[type];
                        return next;
                      })}>
                        {result.message}
                      </Banner>
                    )}

                    <Divider />

                    <InlineStack gap="300">
                      <Button onClick={() => triggerSync(type, "delta")} loading={isSyncing && syncingEntities[type] === "delta"} disabled={s.status === "running"}>
                        Delta Sync
                      </Button>
                      <Button onClick={() => triggerSync(type, "full")} loading={isSyncing && syncingEntities[type] === "full"} disabled={s.status === "running"}>
                        Full Sync
                      </Button>
                      {s.status === "paused" ? (
                        <Button onClick={() => handleResume(type)}>Resume</Button>
                      ) : (
                        <Button tone="critical" variant="plain" onClick={() => handlePause(type)}>
                          Pause
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>
      </BlockStack>
    </Page>
  );
}
