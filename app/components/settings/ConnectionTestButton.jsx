import { useState, useCallback } from "react";
import { Button, Banner, InlineStack, Text, Spinner } from "@shopify/polaris";

export function ConnectionTestButton({ onTest, lastTestAt, lastTestResult }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await onTest();
      setResult(res);
    } catch {
      setResult({ success: false, message: "Connection test failed" });
    } finally {
      setTesting(false);
    }
  }, [onTest]);

  return (
    <div>
      <InlineStack gap="300" blockAlign="center">
        <Button onClick={handleTest} loading={testing}>Test Connection</Button>
        {lastTestAt && (
          <Text as="span" tone="subdued">
            Last test: {new Date(lastTestAt).toLocaleString()} - {lastTestResult || "unknown"}
          </Text>
        )}
      </InlineStack>
      {result && (
        <div style={{ marginTop: "8px" }}>
          <Banner tone={result.success ? "success" : "critical"} onDismiss={() => setResult(null)}>
            {result.message}
          </Banner>
        </div>
      )}
    </div>
  );
}
