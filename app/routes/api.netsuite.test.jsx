
import { json } from "@remix-run/node";
import { useLoaderData } from "react-router";
import { netsuite } from "../services/netsuite/netsuite.server";



export async function loader() {
  // invetory item test
  const itemTest = await netsuite.request("/inventoryItem?limit=1", "GET");

 // orders check
  const orderTest = await netsuite.request("/salesOrder?limit=1", "GET");

  return json({
    inventoryItemStatus: itemTest.status,
    salesOrderStatus: orderTest.status,
    inventoryData: itemTest.data,
    orderData: orderTest.data,
  });
}

export default function TestNS() {
  const data = useLoaderData();
  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>NetSuite Connection Test</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}