import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Layout,
  Card,
  Select,
  TextField,
  Button,
  Badge,
  DataTable,
  Pagination,
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Box,
  Tabs,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSyncLogs } from "../models/sync-log.model";
import { getDeadLetterItems } from "../models/dead-letter.model";

export async function loader({ request }) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "logs";
  const page = parseInt(url.searchParams.get("page") || "1");
  const entityType = url.searchParams.get("entityType") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const direction = url.searchParams.get("direction") || undefined;
  const search = url.searchParams.get("search") || undefined;

  if (tab === "dlq") {
    const dlqResult = await getDeadLetterItems({
      status: url.searchParams.get("dlqStatus") || undefined,
      entityType: entityType,
      page,
      pageSize: 50,
    });
    return json({ tab, dlq: dlqResult, logs: null, page });
  }

  const logsResult = await getSyncLogs({
    entityType: entityType,
    status: status,
    direction: direction,
    search,
    page,
    pageSize: 50,
  });

  return json({ tab, logs: logsResult, dlq: null, page });
}

export default function Logs() {
  const data = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedTab, setSelectedTab] = useState(data.tab === "dlq" ? 1 : 0);
  const [entityFilter, setEntityFilter] = useState(searchParams.get("entityType") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [directionFilter, setDirectionFilter] = useState(searchParams.get("direction") || "");
  const [searchFilter, setSearchFilter] = useState(searchParams.get("search") || "");
  const [selectedLog, setSelectedLog] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const tabs = [
    { id: "logs", content: "Sync Logs" },
    { id: "dlq", content: "Dead Letter Queue" },
  ];

  const handleTabChange = useCallback((index) => {
    setSelectedTab(index);
    const newParams = new URLSearchParams(searchParams);
    newParams.set("tab", index === 1 ? "dlq" : "logs");
    newParams.set("page", "1");
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleFilter = useCallback(() => {
    const newParams = new URLSearchParams();
    newParams.set("tab", selectedTab === 1 ? "dlq" : "logs");
    if (entityFilter) newParams.set("entityType", entityFilter);
    if (statusFilter) newParams.set("status", statusFilter);
    if (directionFilter) newParams.set("direction", directionFilter);
    if (searchFilter) newParams.set("search", searchFilter);
    newParams.set("page", "1");
    setSearchParams(newParams);
  }, [selectedTab, entityFilter, statusFilter, directionFilter, searchFilter, setSearchParams]);

  const handlePageChange = useCallback((newPage) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", String(newPage));
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleRetryDLQ = useCallback(async (id) => {
    setRetrying(id);
    try {
      await fetch(`/api/dlq/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      window.location.reload();
    } finally {
      setRetrying(null);
    }
  }, []);

  const entityOptions = [
    { label: "All", value: "" },
    { label: "Inventory", value: "inventory" },
    { label: "Orders", value: "order" },
    { label: "Customers", value: "customer" },
  ];

  const statusOptions = [
    { label: "All", value: "" },
    { label: "Success", value: "success" },
    { label: "Failed", value: "failed" },
    { label: "Skipped", value: "skipped" },
    { label: "Pending", value: "pending" },
  ];

  const directionOptions = [
    { label: "All", value: "" },
    { label: "NS to Shopify", value: "ns_to_shopify" },
    { label: "Shopify to NS", value: "shopify_to_ns" },
  ];

  const currentPage = data.page;

  const renderLogsTab = () => {
    if (!data.logs) return null;
    const { logs, total } = data.logs;
    const totalPages = Math.ceil(total / 50);

    const rows = logs.map((log) => [
      new Date(log.createdAt).toLocaleString(),
      log.entityType,
      log.direction === "ns_to_shopify" ? "NS \u2192 Shopify" : "Shopify \u2192 NS",
      log.shopifyId?.substring(0, 20) || "-",
      log.netsuiteId || "-",
      log.operation,
      log.status,
      log.durationMs ? `${log.durationMs}ms` : "-",
    ]);

    return (
      <BlockStack gap="400">
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
          headings={["Timestamp", "Entity", "Direction", "Shopify ID", "NetSuite ID", "Op", "Status", "Duration"]}
          rows={rows}
        />
        <InlineStack align="center">
          <Pagination
            hasPrevious={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrevious={() => handlePageChange(currentPage - 1)}
            onNext={() => handlePageChange(currentPage + 1)}
          />
        </InlineStack>
        <Text as="p" tone="subdued" alignment="center">
          {total} total records
        </Text>
      </BlockStack>
    );
  };

  const renderDLQTab = () => {
    if (!data.dlq) return null;
    const { items, total } = data.dlq;
    const totalPages = Math.ceil(total / 50);

    if (items.length === 0) {
      return (
        <Banner tone="success">
          <p>No items in the dead letter queue. All sync operations completed successfully.</p>
        </Banner>
      );
    }

    const rows = items.map((item) => [
      new Date(item.createdAt).toLocaleString(),
      item.entityType,
      item.direction,
      item.operation,
      item.errorMessage?.substring(0, 60) || "",
      `${item.retryCount}/${item.maxRetries}`,
      item.status,
    ]);

    return (
      <BlockStack gap="400">
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
          headings={["Timestamp", "Entity", "Direction", "Op", "Error", "Retries", "Status"]}
          rows={rows}
        />
        <InlineStack align="center">
          <Pagination
            hasPrevious={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrevious={() => handlePageChange(currentPage - 1)}
            onNext={() => handlePageChange(currentPage + 1)}
          />
        </InlineStack>
      </BlockStack>
    );
  };

  return (
    <Page title="Sync Logs" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" wrap>
                <Box minWidth="150px">
                  <Select label="Entity" options={entityOptions} value={entityFilter} onChange={setEntityFilter} />
                </Box>
                <Box minWidth="150px">
                  <Select label="Status" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                </Box>
                <Box minWidth="150px">
                  <Select label="Direction" options={directionOptions} value={directionFilter} onChange={setDirectionFilter} />
                </Box>
                <Box minWidth="200px">
                  <TextField label="Search" value={searchFilter} onChange={setSearchFilter} autoComplete="off" placeholder="Shopify or NetSuite ID" />
                </Box>
                <Box>
                  <div style={{ paddingTop: "24px" }}>
                    <Button onClick={handleFilter}>Apply Filters</Button>
                  </div>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
              <Box paddingBlockStart="400">
                {selectedTab === 0 ? renderLogsTab() : renderDLQTab()}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>

      {selectedLog && (
        <Modal open={!!selectedLog} onClose={() => setSelectedLog(null)} title="Log Details" large>
          <Modal.Section>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
              {JSON.stringify(selectedLog, null, 2)}
            </pre>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
