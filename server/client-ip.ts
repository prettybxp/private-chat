import type { IncomingMessage } from "http";

export type ParsedClientIp = {
  remoteIp: string;
  remotePort?: number;
  ipFamily: "ipv4" | "ipv6" | "unknown";
};

function normalizeIp(raw: string): string {
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

export function parseClientIp(req: IncomingMessage): ParsedClientIp {
  const forwarded = req.headers["x-forwarded-for"];
  let ip = "";
  if (typeof forwarded === "string" && forwarded.length > 0) {
    ip = forwarded.split(",")[0].trim();
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    ip = forwarded[0].split(",")[0].trim();
  }
  if (!ip) {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string") ip = realIp.trim();
  }
  if (!ip && req.socket.remoteAddress) {
    ip = req.socket.remoteAddress;
  }
  ip = normalizeIp(ip || "unknown");
  const port = req.socket.remotePort;
  const ipFamily: ParsedClientIp["ipFamily"] =
    ip.includes(":") ? "ipv6" : ip !== "unknown" ? "ipv4" : "unknown";
  return { remoteIp: ip, remotePort: port, ipFamily };
}

export async function resolveHostHint(ip: string): Promise<string> {
  if (!ip || ip === "unknown" || ip.startsWith("127.")) return "";
  try {
    const dns = await import("dns");
    const names = await dns.promises.reverse(ip);
    return names[0] || "";
  } catch {
    return "";
  }
}

export function buildServerClientInfo(req: IncomingMessage): Record<string, string | number> {
  const parsed = parseClientIp(req);
  const ua = req.headers["user-agent"];
  const info: Record<string, string | number> = {
    remoteIp: parsed.remoteIp,
    ipFamily: parsed.ipFamily,
  };
  if (parsed.remotePort) info.remotePort = parsed.remotePort;
  if (typeof ua === "string") info.userAgent = ua;
  return info;
}
