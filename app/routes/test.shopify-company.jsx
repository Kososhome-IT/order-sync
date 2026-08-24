import { unauthenticated } from "../shopify.server";

const COMPANY_QUERY = `#graphql
  query GetCompany($id: ID!) {
    company(id: $id) {
      id
      name
      externalId
    }
  }
`;

export async function action({ request }) {
  console.log("[SHOPIFY COMPANY TEST] START");

  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "Only POST requests are allowed",
        },
        { status: 405 }
      );
    }

    const body = await request.json();

    const shop = body.shop || process.env.SHOP;
    const companyId = body.companyId;

    console.log("[SHOPIFY COMPANY TEST] INPUT", {
      shop,
      companyId,
    });

    if (!shop) {
      return Response.json(
        {
          success: false,
          error: "Shop domain is required",
        },
        { status: 400 }
      );
    }

    if (!companyId) {
      return Response.json(
        {
          success: false,
          error: "companyId is required",
        },
        { status: 400 }
      );
    }

    const numericCompanyId = String(companyId);

    const companyGid = numericCompanyId.startsWith(
      "gid://shopify/Company/"
    )
      ? numericCompanyId
      : `gid://shopify/Company/${numericCompanyId}`;

    console.log(
      "[SHOPIFY COMPANY TEST] REQUESTING ADMIN CONTEXT",
      {
        shop,
      }
    );

    /*
     * IMPORTANT:
     *
     * Shopify handles the offline session here.
     *
     * If the access token is expired but the refresh token
     * is still valid, the Shopify library should refresh it.
     */
    const { admin, session } =
      await unauthenticated.admin(shop);

    console.log(
      "[SHOPIFY COMPANY TEST] ADMIN CONTEXT CREATED",
      {
        shop: session?.shop,
        isOnline: session?.isOnline,
        hasAccessToken: Boolean(session?.accessToken),
        hasRefreshToken: Boolean(session?.refreshToken),
        expires: session?.expires || null,
        refreshTokenExpires:
          session?.refreshTokenExpires || null,
        isExpired:
          typeof session?.isExpired === "function"
            ? session.isExpired()
            : null,
        isActive:
          typeof session?.isActive === "function"
            ? session.isActive()
            : null,
      }
    );

    console.log(
      "[SHOPIFY COMPANY TEST] FETCHING COMPANY",
      {
        companyGid,
      }
    );

    /*
     * NOTE:
     *
     * We intentionally use admin.graphql() here because this
     * Admin object comes from Shopify's unauthenticated.admin()
     * context.
     */
    const response = await admin.graphql(
      COMPANY_QUERY,
      {
        variables: {
          id: companyGid,
        },
      }
    );

    const result = await response.json();

    console.log(
      "[SHOPIFY COMPANY TEST] GRAPHQL RESPONSE",
      JSON.stringify(result, null, 2)
    );

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          step: "shopify_graphql",
          status: response.status,
          result,
        },
        { status: 500 }
      );
    }

    if (result.errors?.length) {
      return Response.json(
        {
          success: false,
          step: "shopify_graphql",
          errors: result.errors,
        },
        { status: 500 }
      );
    }

    if (!result.data?.company) {
      return Response.json(
        {
          success: false,
          step: "company_lookup",
          error: "Company not found",
          companyGid,
        },
        { status: 404 }
      );
    }

    console.log(
      "[SHOPIFY COMPANY TEST] SUCCESS",
      result.data.company
    );

    return Response.json({
      success: true,

      shop,

      company: result.data.company,

      session: {
        isOnline: session?.isOnline ?? null,
        expires: session?.expires || null,
        refreshTokenExpires:
          session?.refreshTokenExpires || null,
        isExpired:
          typeof session?.isExpired === "function"
            ? session.isExpired()
            : null,
        isActive:
          typeof session?.isActive === "function"
            ? session.isActive()
            : null,
      },
    });
  } catch (error) {
    console.error(
      "[SHOPIFY COMPANY TEST] ERROR",
      error
    );

    return Response.json(
      {
        success: false,
        error: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}