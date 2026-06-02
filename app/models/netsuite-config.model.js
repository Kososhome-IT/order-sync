import { query } from "../../db/client";
import { encrypt, decrypt } from "../utils/crypto";

export async function getNetSuiteConfig() {
  const result = await query("SELECT * FROM netsuite_config WHERE is_active = TRUE LIMIT 1");
  if (!result.rows[0]) return null;
  return mapRow(result.rows[0]);
}

export async function saveNetSuiteConfig(input) {
  const clientSecretEnc = encrypt(input.clientSecret);
  const privateKeyEnc = encrypt(input.privateKey);

  const existing = await query("SELECT id FROM netsuite_config WHERE is_active = TRUE LIMIT 1");

  let result;
  if (existing.rows[0]) {
    result = await query(
      `UPDATE netsuite_config SET
         account_id = $1, client_id = $2, client_secret_enc = $3, private_key_enc = $4,
         certificate_id = $5, restlet_urls = $6, scopes = $7, token_cache = NULL, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        input.accountId,
        input.clientId,
        clientSecretEnc,
        privateKeyEnc,
        input.certificateId,
        JSON.stringify(input.restletUrls),
        input.scopes || ["rest_webservices", "restlets"],
        existing.rows[0].id,
      ],
    );
  } else {
    result = await query(
      `INSERT INTO netsuite_config (account_id, client_id, client_secret_enc, private_key_enc, certificate_id, restlet_urls, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.accountId,
        input.clientId,
        clientSecretEnc,
        privateKeyEnc,
        input.certificateId,
        JSON.stringify(input.restletUrls),
        input.scopes || ["rest_webservices", "restlets"],
      ],
    );
  }

  return mapRow(result.rows[0]);
}

export async function updateTokenCache(
  configId,
  tokenCache,
) {
  await query(
    "UPDATE netsuite_config SET token_cache = $1, updated_at = NOW() WHERE id = $2",
    [JSON.stringify(tokenCache), configId],
  );
}

export async function updateTestResult(
  configId,
  result,
) {
  await query(
    "UPDATE netsuite_config SET last_test_at = NOW(), last_test_result = $1, updated_at = NOW() WHERE id = $2",
    [result, configId],
  );
}

export async function clearTokenCache(configId) {
  await query(
    "UPDATE netsuite_config SET token_cache = NULL, updated_at = NOW() WHERE id = $1",
    [configId],
  );
}

export function getDecryptedSecret(config) {
  return decrypt(config.clientSecretEnc);
}

export function getDecryptedPrivateKey(config) {
  return decrypt(config.privateKeyEnc);
}

function mapRow(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id,
    clientSecretEnc: row.client_secret_enc,
    privateKeyEnc: row.private_key_enc,
    certificateId: row.certificate_id,
    restletUrls: row.restlet_urls,
    tokenCache: row.token_cache,
    scopes: row.scopes,
    isActive: row.is_active,
    lastTestAt: row.last_test_at ? new Date(row.last_test_at) : undefined,
    lastTestResult: row.last_test_result,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
