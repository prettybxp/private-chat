import type { ClientInfo } from "./protocol.js";

const MAX_CLIENT_INFO_BYTES = 8192;

export function sanitizeClientInfo(raw: unknown): ClientInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: ClientInfo = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || k.length > 64) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null
    ) {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v.slice(0, 32);
    }
  }
  if (JSON.stringify(out).length > MAX_CLIENT_INFO_BYTES) return null;
  return out;
}

export function mergeClientInfo(
  serverPart: Record<string, string | number>,
  clientPart: ClientInfo | null
): ClientInfo {
  return { ...(clientPart || {}), ...serverPart };
}
