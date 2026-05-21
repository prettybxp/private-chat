import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "chat_admin";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 未设置环境变量时的默认后台密码，生产环境请用 ADMIN_PASSWORD 覆盖 */
export const DEFAULT_ADMIN_PASSWORD = "baofish";

function getSecret(): string {
  return (
    process.env.ADMIN_SECRET ||
    process.env.ADMIN_PASSWORD ||
    DEFAULT_ADMIN_PASSWORD
  );
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createAdminToken(): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  if (sign(expStr) !== sig) return false;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;
  return true;
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

export function setAdminCookie(res: Response): void {
  const token = createAdminToken();
  const maxAge = Math.floor(TOKEN_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

export function clearAdminCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (typeof token === "string" && verifyAdminToken(token)) {
    next();
    return;
  }
  res.status(401).json({ error: "未登录" });
}
