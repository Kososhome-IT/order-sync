import { Banner } from "@shopify/polaris";

export function ErrorBanner({ title, message, onDismiss }) {
  return (
    <Banner title={title} tone="critical" onDismiss={onDismiss}>
      <p>{message}</p>
    </Banner>
  );
}
