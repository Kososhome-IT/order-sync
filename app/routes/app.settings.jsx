import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "react-router";
import {
  Page,
  Layout,
  Card,
  Box,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Checkbox,
  FormLayout,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getNetSuiteConfig, saveNetSuiteConfig } from "../models/netsuite-config.model";
import { getAllSyncStates, updateSyncState } from "../models/sync-state.model";
import { netsuiteConfigSchema, syncScheduleSchema } from "../utils/validators";

export async function loader({ request }) {
  await authenticate.admin(request);

  const [config, syncStates] = await Promise.all([
    getNetSuiteConfig(),
    getAllSyncStates(),
  ]);

  return json({
    config: config
      ? {
          accountId: config.accountId,
          clientId: config.clientId,
          certificateId: config.certificateId,
          restletUrls: config.restletUrls,
          lastTestAt: config.lastTestAt?.toISOString() || null,
          lastTestResult: config.lastTestResult || null,
        }
      : null,
    syncStates: syncStates.map((s) => ({
      entityType: s.entityType,
      cronExpression: s.cronExpression,
      isEnabled: s.isEnabled,
    })),
  });
}

export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.json();
  const { _action, ...data } = formData;

  if (_action === "saveConfig") {
    const parsed = netsuiteConfigSchema.safeParse(data);
    if (!parsed.success) {
      return json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    await saveNetSuiteConfig(parsed.data);
    return json({ success: true, message: "Configuration saved" });
  }

  if (_action === "saveSchedule") {
    const parsed = syncScheduleSchema.safeParse(data);
    if (!parsed.success) {
      return json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    await updateSyncState(parsed.data.entityType, {
      cronExpression: parsed.data.cronExpression,
      isEnabled: parsed.data.isEnabled,
    });
    return json({ success: true, message: "Schedule updated" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function Settings() {
  const { config, syncStates } = useLoaderData();

  const [accountId, setAccountId] = useState(config?.accountId || "");
  const [clientId, setClientId] = useState(config?.clientId || "");
  const [clientSecret, setClientSecret] = useState("");
  const [certificateId, setCertificateId] = useState(config?.certificateId || "");
  const [privateKey, setPrivateKey] = useState("");
  const [inventoryUrl, setInventoryUrl] = useState(config?.restletUrls?.inventory || "");
  const [customerUrl, setCustomerUrl] = useState(config?.restletUrls?.customer || "");
  const [salesorderUrl, setSalesorderUrl] = useState(config?.restletUrls?.salesorder || "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  const [schedules, setSchedules] = useState(syncStates);

  const handleSaveConfig = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _action: "saveConfig",
          accountId,
          clientId,
          clientSecret,
          certificateId,
          privateKey,
          restletUrls: { inventory: inventoryUrl, customer: customerUrl, salesorder: salesorderUrl },
        }),
      });
      const data = await res.json();
      setSaveResult({
        success: data.success,
        message: data.message || data.error || "Saved",
      });
    } catch {
      setSaveResult({ success: false, message: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }, [accountId, clientId, clientSecret, certificateId, privateKey, inventoryUrl, customerUrl, salesorderUrl]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/netsuite/test", { method: "POST" });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || data.error,
      });
    } catch {
      setTestResult({ success: false, message: "Connection test failed" });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleSaveSchedule = useCallback(async (entityType, cronExpression, isEnabled) => {
    await fetch("/app/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _action: "saveSchedule", entityType, cronExpression, isEnabled }),
    });
  }, []);

  return (
    <Page title="NetSuite Connection Settings" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">NetSuite Credentials</Text>

              {saveResult && (
                <Banner tone={saveResult.success ? "success" : "critical"} onDismiss={() => setSaveResult(null)}>
                  {saveResult.message}
                </Banner>
              )}

              <FormLayout>
                <TextField label="Account ID" value={accountId} onChange={setAccountId} autoComplete="off" helpText="Your NetSuite account ID (e.g., 1234567)" />
                <TextField label="Client ID" value={clientId} onChange={setClientId} autoComplete="off" />
                <TextField label="Client Secret" value={clientSecret} onChange={setClientSecret} type="password" autoComplete="off" helpText={config ? "Leave blank to keep existing" : "Required"} />
                <TextField label="Certificate ID" value={certificateId} onChange={setCertificateId} autoComplete="off" />
                <TextField label="Private Key (PEM)" value={privateKey} onChange={setPrivateKey} multiline={4} autoComplete="off" helpText={config ? "Leave blank to keep existing" : "Paste your ES256 private key in PEM format"} />
              </FormLayout>

              <Divider />
              <Text variant="headingMd" as="h2">RESTlet URLs</Text>

              <FormLayout>
                <TextField label="Inventory RESTlet URL" value={inventoryUrl} onChange={setInventoryUrl} autoComplete="off" />
                <TextField label="Customer RESTlet URL" value={customerUrl} onChange={setCustomerUrl} autoComplete="off" />
                <TextField label="Sales Order RESTlet URL" value={salesorderUrl} onChange={setSalesorderUrl} autoComplete="off" />
              </FormLayout>

              <InlineStack gap="300">
                <Button variant="primary" onClick={handleSaveConfig} loading={saving}>Save Configuration</Button>
                <Button onClick={handleTestConnection} loading={testing}>Test Connection</Button>
              </InlineStack>

              {testResult && (
                <Banner tone={testResult.success ? "success" : "critical"} onDismiss={() => setTestResult(null)}>
                  {testResult.message}
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Sync Schedules</Text>

              {schedules.map((schedule, i) => (
                <InlineStack key={schedule.entityType} gap="400" align="center" blockAlign="center">
                  <Box minWidth="100px">
                    <Text as="span" fontWeight="semibold">
                      {schedule.entityType.charAt(0).toUpperCase() + schedule.entityType.slice(1)}
                    </Text>
                  </Box>
                  <Box minWidth="200px">
                    <TextField
                      label=""
                      labelHidden
                      value={schedule.cronExpression}
                      onChange={(val) => {
                        const updated = [...schedules];
                        updated[i] = { ...updated[i], cronExpression: val };
                        setSchedules(updated);
                      }}
                      autoComplete="off"
                      placeholder="*/15 * * * *"
                    />
                  </Box>
                  <Checkbox
                    label="Enabled"
                    checked={schedule.isEnabled}
                    onChange={(val) => {
                      const updated = [...schedules];
                      updated[i] = { ...updated[i], isEnabled: val };
                      setSchedules(updated);
                    }}
                  />
                  <Button
                    size="slim"
                    onClick={() => handleSaveSchedule(schedule.entityType, schedule.cronExpression, schedule.isEnabled)}
                  >
                    Save
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
