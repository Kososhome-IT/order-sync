import { Card, EmptyState as PolarisEmptyState } from "@shopify/polaris";

export function EmptyState({ heading, body, action }) {
  return (
    <Card>
      <PolarisEmptyState
        heading={heading}
        action={action ? { content: action.label, onAction: action.onAction } : undefined}
      >
        <p>{body}</p>
      </PolarisEmptyState>
    </Card>
  );
}
