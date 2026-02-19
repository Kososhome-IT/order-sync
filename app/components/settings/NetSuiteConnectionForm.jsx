import { useState } from "react";
import { FormLayout, TextField, Button, Banner, BlockStack } from "@shopify/polaris";

export function NetSuiteConnectionForm({ config, onSave, isSaving }) {
  const [accountId, setAccountId] = useState(config?.accountId || "");
  const [clientId, setClientId] = useState(config?.clientId || "");
  const [clientSecret, setClientSecret] = useState("");
  const [certificateId, setCertificateId] = useState(config?.certificateId || "");
  const [privateKey, setPrivateKey] = useState("");
  const [inventoryUrl, setInventoryUrl] = useState(config?.restletUrls?.inventory || "");
  const [customerUrl, setCustomerUrl] = useState(config?.restletUrls?.customer || "");
  const [salesorderUrl, setSalesorderUrl] = useState(config?.restletUrls?.salesorder || "");

  const handleSubmit = () => {
    onSave({
      accountId,
      clientId,
      clientSecret,
      certificateId,
      privateKey,
      restletUrls: { inventory: inventoryUrl, customer: customerUrl, salesorder: salesorderUrl },
    });
  };

  return (
    <BlockStack gap="400">
      <FormLayout>
        <TextField label="Account ID" value={accountId} onChange={setAccountId} autoComplete="off" />
        <TextField label="Client ID" value={clientId} onChange={setClientId} autoComplete="off" />
        <TextField label="Client Secret" value={clientSecret} onChange={setClientSecret} type="password" autoComplete="off" helpText={config ? "Leave blank to keep existing" : ""} />
        <TextField label="Certificate ID" value={certificateId} onChange={setCertificateId} autoComplete="off" />
        <TextField label="Private Key (PEM)" value={privateKey} onChange={setPrivateKey} multiline={4} autoComplete="off" />
        <TextField label="Inventory RESTlet URL" value={inventoryUrl} onChange={setInventoryUrl} autoComplete="off" />
        <TextField label="Customer RESTlet URL" value={customerUrl} onChange={setCustomerUrl} autoComplete="off" />
        <TextField label="Sales Order RESTlet URL" value={salesorderUrl} onChange={setSalesorderUrl} autoComplete="off" />
      </FormLayout>
      <Button variant="primary" onClick={handleSubmit} loading={isSaving}>Save Configuration</Button>
    </BlockStack>
  );
}
