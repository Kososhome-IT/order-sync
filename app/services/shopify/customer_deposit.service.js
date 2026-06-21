import { netsuite } from "../netsuite/netsuite.server";

export async function applyDepositToSalesOrder(depositPayload) {
  console.log("Creating Customer Deposit...");
  const result = await netsuite.createCustomerDeposit(depositPayload);

  if (result.success) {
    console.log("✅ Customer Deposit Created Successfully!");
    console.log("Status Code:", result.status);
    console.log("New Deposit Location:", result.location); 
  } else {
    console.error("❌ Failed to create Customer Deposit:", result.data);
  }
}
