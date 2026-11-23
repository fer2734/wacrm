import { readFileSync } from "node:fs";
type PrivateWASecrets = { gatewayUrl?: string; gatewayToken?: string; callbackSecret?: string };
let fileSecrets: PrivateWASecrets | null = null;
/** Server-only config. Secrets are mounted by EasyPanel, never committed to GitHub. */
export function privateWASecrets(): Required<PrivateWASecrets> {
  if (fileSecrets === null) {
    try { fileSecrets = JSON.parse(readFileSync("/app/private-wa-secret.json", "utf8")) as PrivateWASecrets; }
    catch { fileSecrets = {}; }
  }
  return {
    gatewayUrl: process.env.PRIVATE_WA_GATEWAY_URL || fileSecrets.gatewayUrl || "",
    gatewayToken: process.env.PRIVATE_WA_GATEWAY_TOKEN || fileSecrets.gatewayToken || "",
    callbackSecret: process.env.PRIVATE_WA_CALLBACK_SECRET || fileSecrets.callbackSecret || "",
  };
}
