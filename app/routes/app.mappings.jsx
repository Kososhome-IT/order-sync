import { json } from "@remix-run/node";
import { useLoaderData, Outlet, useNavigate, useLocation } from "react-router";
import { Page, Tabs } from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}

export default function Mappings() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { id: "inventory", content: "Inventory", url: "/app/mappings/inventory" },
    { id: "order", content: "Orders", url: "/app/mappings/order" },
    { id: "customer", content: "Customers", url: "/app/mappings/customer" },
  ];

  const currentEntity = location.pathname.split("/").pop() || "inventory";
  const selectedIndex = tabs.findIndex((t) => t.id === currentEntity);

  const handleTabChange = useCallback(
    (index) => {
      navigate(tabs[index].url);
    },
    [navigate],
  );

  return (
    <Page title="Field Mappings" backAction={{ url: "/app" }}>
      <Tabs tabs={tabs} selected={selectedIndex >= 0 ? selectedIndex : 0} onSelect={handleTabChange}>
        <Outlet />
      </Tabs>
    </Page>
  );
}
