import { Modal, Text } from "@shopify/polaris";

export function ConfirmationModal({
  open, title, message, confirmLabel = "Confirm", onConfirm, onCancel, destructive = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      primaryAction={{
        content: confirmLabel,
        onAction: onConfirm,
        destructive,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onCancel }]}
    >
      <Modal.Section>
        <Text as="p">{message}</Text>
      </Modal.Section>
    </Modal>
  );
}
