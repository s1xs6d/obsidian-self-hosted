// Origin-relative base URL — works from any hostname/IP, not just localhost.
export const BASE_URL = (location.protocol + "//" + location.host).replace(/\/$/, "");

// Vault ID from query string (/app?vault=xxx)
export const VAULT_ID_HOLDER = { value: "" };
try {
  VAULT_ID_HOLDER.value = new URLSearchParams(location.search).get("vault") || "";
} catch (_) {}

export function getVaultId() {
  return VAULT_ID_HOLDER.value;
}
export function setVaultId(v) {
  VAULT_ID_HOLDER.value = v;
}

export function vaultQuery() {
  const id = VAULT_ID_HOLDER.value;
  return id ? "?vault=" + encodeURIComponent(id) : "";
}
