import fetch from "node-fetch";
import OAuth from "oauth-1.0a";
import crypto from "node:crypto";

class NetSuiteClient {
  constructor() {
    this.oauth = new OAuth({
      consumer: {
        key: process.env.NETSUITE_CONSUMER_KEY,
        secret: process.env.NETSUITE_CONSUMER_SECRET,
      },
      signature_method: "HMAC-SHA256",
      hash_function(base_string, key) {
        return crypto
          .createHmac("sha256", key)
          .update(base_string)
          .digest("base64");
      },
    });

    this.token = {
      key: process.env.NETSUITE_TOKEN_ID,
      secret: process.env.NETSUITE_TOKEN_SECRET,
    };

    const accountId = process.env.NETSUITE_ACCOUNT_ID || "";
    this.realm = process.env.NETSUITE_REALM || "";
    
    // Base URL setup
    const domainPrefix = accountId.toLowerCase().replace("_", "-");
    this.baseUrl = `https://${domainPrefix}.suitetalk.api.netsuite.com/services/rest/record/v1`;
  }

  // helper method OAuth Headers 
  async request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const requestData = {
      url,
      method,
    };

    const oauthHeader = this.oauth.toHeader(
      this.oauth.authorize(requestData, this.token)
    );

    oauthHeader.Authorization =
      `OAuth realm="${this.realm}", ` +
      oauthHeader.Authorization.substring(6);

    const headers = {
      ...oauthHeader,
      "Accept": "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
   const location = response.headers.get("location");

    if (response.status === 204) {
    return {
        success: true,
        status: response.status,
        location,
    };
    }

    const data = await response.json();
    
    return {
      success: response.ok,
      status: response.status,
      data,
    };
  }

  // 1. Get Orders (Fetch)
  async getOrder(orderId) {
    return this.request(`/salesOrder/${orderId}`, "GET");
  }

  async getOrderItems(orderId) {
  return this.request(
    `/salesOrder/${orderId}/item`,
    "GET"
  );
}

async getOrderItem(orderId, lineId) {
  return this.request(
    `/salesOrder/${orderId}/item/${lineId}`,
    "GET"
  );
}
  // 2. Create Order
  async createOrder(orderData) {
    return this.request("/salesOrder", "POST", orderData);
  }

  // 3. Update Order
async updateOrder(orderId, orderData) {
  return this.request(
    `/salesOrder/${orderId}?replace=item`,
    "PATCH",
    orderData
  );
}
// helper for other uses
async getByUrl(url) {
  return this.requestAbsolute(url, "GET");
}
}

// client exported
export const netsuite = new NetSuiteClient();