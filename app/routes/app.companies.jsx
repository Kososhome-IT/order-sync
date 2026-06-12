import prisma from "../db.server";
import { json } from "../utils/jsonResponse";
import { useLoaderData } from "react-router";

export async function loader() {
  const companies =
    await prisma.companyMapping.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

  return json({ companies });
}



export default function CompaniesPage() {
  const { companies } = useLoaderData();

  return (
    <div style={{ padding: "20px" }}>
      <h1>Company Mappings</h1>

      <table
        border="1"
        cellPadding="10"
        style={{
          borderCollapse: "collapse",
          width: "100%",
        }}
      >
        <thead>
          <tr>
            <th>Shopify Company ID</th>
            <th>Company Name</th>
            <th>Shopify Location ID</th>
            <th>NetSuite Company ID</th>
          </tr>
        </thead>

        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>
                {company.shopifyCompanyId}
              </td>

              <td>
                {company.shopifyCompanyName}
              </td>

              <td>
                {company.shopifyCompanyLocationId}
              </td>

              <td>
                {company.netsuiteCompanyId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}