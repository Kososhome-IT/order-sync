// helper to get varient iod from sku
export async function getVariantIdBySKU(admin, sku) {
  const query = `
    query getVariantBySku($query: String!) {
      productVariants(first: 1, query: $query) {
        edges {
          node {
            id
            sku
          }
        }
      }
    }
  `;

  const res = await admin.request(query, {
    variables: {
      query: `sku:${sku}`,
    },
  });

  const edges = res?.data?.productVariants?.edges;

  if (!edges || edges.length === 0) {
    throw new Error(`Variant not found for SKU: ${sku}`);
  }

  return edges[0].node.id;
}

//  end 