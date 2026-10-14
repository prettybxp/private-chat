import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { ChatFile } from "./protocol.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FILES_DIR = path.join(DATA_DIR, "files");

const FILE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;

const URL_RE =
  /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|gif|webp))$/;

type ImageKind = { ext: "jpg" | "png" | "gif" | "webp"; mime: string };

export function detectImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12 || buf.length > MAX_IMAGE_BYTES) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { ext: "gif", mime: "image/gif" };
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export function saveImage(buf: Buffer): { url: string } | null {
  const kind = detectImage(buf);
  if (!kind) return null;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${kind.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: `/uploads/${name}` };
}

export function resolveUpload(name: string): string | null {
  if (!FILE_RE.test(name)) return null;
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return null;
  return file;
}

export function uploadExists(url: string): boolean {
  const match = URL_RE.exec(url);
  if (!match) return false;
  return resolveUpload(match[1]) !== null;
}

export function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = URL_RE.exec(raw);
  return match ? raw : null;
}

export function clearUploads(): void {
  if (!fs.existsSync(UPLOAD_DIR)) return;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (!FILE_RE.test(name)) continue;
    fs.unlinkSync(path.join(UPLOAD_DIR, name));
  }
}

export function sanitizeDownloadName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw.replace(/\\/g, "/").split("/").pop() || "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "").trim().slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned;
}

export function saveAttachment(buf: Buffer, name: string): ChatFile | null {
  const safeName = sanitizeDownloadName(name);
  if (!safeName || buf.length < 1 || buf.length > MAX_IMAGE_BYTES) return null;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const id = randomUUID();
  fs.writeFileSync(path.join(FILES_DIR, id), buf);
  return { url: `/files/${id}`, name: safeName, size: buf.length };
}

export function resolveAttachment(id: string): string | null {
  if (!FILE_ID_RE.test(id)) return null;
  const file = path.join(FILES_DIR, id);
  if (!fs.existsSync(file)) return null;
  return file;
}

export function acceptChatFile(raw: unknown): { ok: true; file: ChatFile | null } | { ok: false } {
  if (raw == null) return { ok: true, file: null };
  if (!raw || typeof raw !== "object") return { ok: false };
  const obj = raw as { url?: unknown; name?: unknown; size?: unknown };
  if (typeof obj.url !== "string") return { ok: false };
  const match = /^\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
    obj.url
  );
  if (!match) return { ok: false };
  const disk = resolveAttachment(match[1]);
  if (!disk) return { ok: false };
  const name = sanitizeDownloadName(obj.name);
  if (!name) return { ok: false };
  if (!Number.isInteger(obj.size) || (obj.size as number) < 1 || (obj.size as number) > MAX_IMAGE_BYTES) {
    return { ok: false };
  }
  if (fs.statSync(disk).size !== obj.size) return { ok: false };
  return { ok: true, file: { url: obj.url, name, size: obj.size as number } };
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function clearAttachments(): void {
  if (!fs.existsSync(FILES_DIR)) return;
  for (const name of fs.readdirSync(FILES_DIR)) {
    if (!FILE_ID_RE.test(name)) continue;
    fs.unlinkSync(path.join(FILES_DIR, name));
  }
}
