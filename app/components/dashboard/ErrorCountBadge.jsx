import { Badge } from "@shopify/polaris";

export function ErrorCountBadge({ count, threshold }) {
  const tone = getTone(count, threshold);

  return <Badge tone={tone}>{count.toLocaleString()}</Badge>;
}

function getTone(count, threshold) {
  if (count === 0) {
    return "success";
  }
  if (count < threshold) {
    return "warning";
  }
  return "critical";
}
