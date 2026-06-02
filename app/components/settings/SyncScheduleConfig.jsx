import { useState, useCallback } from "react";
import { BlockStack, InlineStack, TextField, Checkbox, Button, Text, Box } from "@shopify/polaris";

export function SyncScheduleConfig({ schedules: initial, onSave }) {
  const [schedules, setSchedules] = useState(initial);
  const [saving, setSaving] = useState(false);

  const handleChange = useCallback((index, field, value) => {
    setSchedules((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(schedules);
    } finally {
      setSaving(false);
    }
  }, [schedules, onSave]);

  return (
    <BlockStack gap="400">
      {schedules.map((s, i) => (
        <InlineStack key={s.entityType} gap="400" blockAlign="center">
          <Box minWidth="100px">
            <Text as="span" fontWeight="semibold">
              {s.entityType.charAt(0).toUpperCase() + s.entityType.slice(1)}
            </Text>
          </Box>
          <Box minWidth="200px">
            <TextField label="" labelHidden value={s.cronExpression} onChange={(val) => handleChange(i, "cronExpression", val)} autoComplete="off" />
          </Box>
          <Checkbox label="Enabled" checked={s.isEnabled} onChange={(val) => handleChange(i, "isEnabled", val)} />
        </InlineStack>
      ))}
      <Button variant="primary" onClick={handleSave} loading={saving}>Save Schedules</Button>
    </BlockStack>
  );
}
