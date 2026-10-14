import express, { type NextFunction, type Request, type Response } from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  buildServerClientInfo,
  resolveHostHint,
} from "./client-ip.js";
import { mergeClientInfo, sanitizeClientInfo } from "./client-info-util.js";
import {
  clearAdminCookie,
  getAdminPassword,
  requireAdmin,
  setAdminCookie,
} from "./auth.js";
import type { ClientMessage, ServerPayload } from "./protocol.js";
import { room, sanitizeCaption, sanitizeNickname, sanitizeSource } from "./room.js";
import * as store from "./store.js";
import {
  MAX_IMAGE_BYTES,
  acceptChatFile,
  clearAttachments,
  clearUploads,
  contentDisposition,
  resolveAttachment,
  resolveUpload,
  sanitizeDownloadName,
  sanitizeImageUrl,
  saveAttachment,
  saveImage,
  uploadExists,
} from "./uploads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8088;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const isProd = process.env.NODE_ENV === "production";
const clientStatic = isProd
  ? path.join(__dirname, "../client")
  : null;

room.loadHistory(store.loadRecentMessages(100));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const uploadBuckets = new Map<string, { count: number; resetAt: number }>();

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function allowUpload(ip: string): boolean {
  const now = Date.now();
  let bucket = uploadBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    uploadBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= 20;
}

app.post(
  "/api/upload",
  express.raw({
    limit: MAX_IMAGE_BYTES,
    type: (req) => {
      const type = String(req.headers["content-type"] || "");
      return type.startsWith("image/") || type.startsWith("application/octet-stream");
    },
  }),
  (req, res) => {
    if (!readCookie(req.headers.cookie, "chat_nickname")) {
      res.status(401).json({ error: "请先进入聊天室" });
      return;
    }
    const ip = req.socket.remoteAddress || "unknown";
    if (!allowUpload(ip)) {
      res.status(429).json({ error: "上传过于频繁，请稍后再试" });
      return;
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "请选择图片文件" });
      return;
    }
    const saved = saveImage(body);
    if (!saved) {
      res.status(400).json({ error: "仅支持 10MB 以内的 JPG、PNG、GIF、WebP" });
      return;
    }
    res.json({ ok: true, url: saved.url });
  }
);

app.get("/uploads/:name", (req, res) => {
  const file = resolveUpload(req.params.name);
  if (!file) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

app.get("/files/:id", (req, res) => {
  const file = resolveAttachment(req.params.id);
  if (!file) {
    res.status(404).end();
    return;
  }
  const name = sanitizeDownloadName(req.query.name) || "download";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(name));
  res.sendFile(file);
});

app.post("/api/admin/login", (req, res) => {
  if (req.body?.password !== getAdminPassword()) {
    res.status(401).json({ error: "密码错误" });
    return;
  }
  setAdminCookie(res);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/messages", requireAdmin, (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 50;
  const nickname = typeof req.query.nickname === "string" ? req.query.nickname : undefined;
  const from = req.query.from ? Number(req.query.from) : undefined;
  const to = req.query.to ? Number(req.query.to) : undefined;
  res.json(store.listMessages({ page, pageSize, nickname, from, to }));
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  res.json({ users: store.listUsers() });
});

app.get("/api/admin/users/:clientId", requireAdmin, (req, res) => {
  const user = store.getUser(req.params.clientId);
  if (!user) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  res.json(user);
});

app.post("/api/admin/messages/clear", requireAdmin, (_req, res) => {
  const result = store.clearMessages();
  clearUploads();
  clearAttachments();
  room.clearHistory();
  broadcast({ type: "history", messages: [] });
  res.json({ ok: true, ...result });
});

app.delete("/api/admin/users/:clientId", requireAdmin, (req, res) => {
  const ok = store.deleteUser(req.params.clientId);
  if (!ok) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/users/clear", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...store.clearUsers() });
});

if (clientStatic) {
  app.use(express.static(clientStatic));
  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(clientStatic, "admin/index.html"));
  });
  app.get("/admin/", (_req, res) => {
    res.sendFile(path.join(clientStatic, "admin/index.html"));
  });
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(clientStatic, "index.html"));
  });
}

type ConnectionState = {
  clientId?: string;
  nickname?: string;
  joined: boolean;
};

type PendingUpload = {
  id: string;
  size: number;
  received: number;
  nextSeq: number;
  parts: Buffer[];
  kind: "image" | "file";
  name: string;
};

const IMAGE_CHUNK_BYTES = 256 * 1024;

function send(ws: WebSocket, payload: ServerPayload): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload: ServerPayload): void {
  const data = JSON.stringify(payload);
  room.forEachSocket((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
}

function broadcastMembers(): void {
  broadcast({ type: "members", members: room.getMembers() });
}

wss.on("connection", (ws, req) => {
  const state: ConnectionState = { joined: false };
  let pendingUpload: PendingUpload | null = null;

  const failUpload = (message: string): void => {
    pendingUpload = null;
    send(ws, { type: "error", code: "UPLOAD_FAILED", message });
  };

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: "error", code: "INVALID_JSON", message: "无效的消息格式" });
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

    if (msg.type === "image-begin") {
      if (!state.joined) {
        send(ws, { type: "error", code: "NOT_JOINED", message: "请先加入聊天室" });
        return;
      }
      if (typeof msg.uploadId !== "string" || msg.uploadId.length < 8 || msg.uploadId.length > 64) {
        failUpload("图片上传无效");
        return;
      }
      if (!Number.isInteger(msg.size) || msg.size < 1 || msg.size > MAX_IMAGE_BYTES) {
        failUpload("不能超过 10MB");
        return;
      }
      const kind = msg.kind === "file" ? "file" : "image";
      const name = kind === "file" ? sanitizeDownloadName(msg.name) : "";
      if (kind === "file" && !name) {
        failUpload("文件名无效");
        return;
      }
      pendingUpload = {
        id: msg.uploadId,
        size: msg.size,
        received: 0,
        nextSeq: 0,
        parts: [],
        kind,
        name: name || "",
      };
      return;
    }

    if (msg.type === "image-chunk") {
      if (
        !pendingUpload ||
        msg.uploadId !== pendingUpload.id ||
        msg.seq !== pendingUpload.nextSeq ||
        typeof msg.data !== "string" ||
        msg.data.length > IMAGE_CHUNK_BYTES * 2
      ) {
        failUpload("图片上传中断");
        return;
      }
      const part = Buffer.from(msg.data, "base64");
      if (part.length < 1 || part.length > IMAGE_CHUNK_BYTES) {
        failUpload("图片上传中断");
        return;
      }
      pendingUpload.parts.push(part);
      pendingUpload.received += part.length;
      pendingUpload.nextSeq += 1;
      if (pendingUpload.received > pendingUpload.size) {
        failUpload("图片不能超过 10MB");
      }
      return;
    }

    if (msg.type === "image-end") {
      if (!pendingUpload || msg.uploadId !== pendingUpload.id) {
        failUpload("图片上传中断");
        return;
      }
      const upload = pendingUpload;
      pendingUpload = null;
      if (upload.received !== upload.size) {
        send(ws, { type: "error", code: "UPLOAD_FAILED", message: "图片上传不完整" });
        return;
      }
      const buf = Buffer.concat(upload.parts, upload.received);
      if (upload.kind === "file") {
        const saved = saveAttachment(buf, upload.name);
        if (!saved) {
          send(ws, { type: "error", code: "UPLOAD_FAILED", message: "文件保存失败" });
          return;
        }
        send(ws, {
          type: "uploaded",
          uploadId: upload.id,
          url: saved.url,
          name: saved.name,
          size: saved.size,
        });
        return;
      }
      const saved = saveImage(buf);
      if (!saved) {
        send(ws, {
          type: "error",
          code: "UPLOAD_FAILED",
          message: "仅支持 10MB 以内的 JPG、PNG、GIF、WebP",
        });
        return;
      }
      send(ws, { type: "uploaded", uploadId: upload.id, url: saved.url });
      return;
    }

    if (msg.type === "activity") {
      if (!state.joined || typeof msg.active !== "boolean") return;
      if (room.setActivity(ws, msg.active)) {
        broadcastMembers();
      }
      return;
    }

    if (msg.type === "join") {
      if (!msg.clientId || typeof msg.clientId !== "string") {
        send(ws, { type: "error", code: "INVALID_CLIENT", message: "缺少 clientId" });
        return;
      }
      const validNickname = sanitizeNickname(msg.nickname);
      if (!validNickname) {
        send(ws, {
          type: "error",
          code: "INVALID_NICKNAME",
          message: "昵称须为 1–20 个字符",
        });
        return;
      }

      const source = sanitizeSource(msg.source);
      const serverInfo = buildServerClientInfo(req);
      const clientPart = sanitizeClientInfo(msg.clientInfo);
      const merged = mergeClientInfo(serverInfo, {
        ...clientPart,
        connectionSource: source,
      });

      state.clientId = msg.clientId;
      state.nickname = validNickname;
      state.joined = true;
      room.join(msg.clientId, validNickname, ws, source);

      store.upsertUser(msg.clientId, validNickname, merged);

      const ip = String(merged.remoteIp || "");
      resolveHostHint(ip).then((hostHint) => {
        if (hostHint) {
          store.patchUserClientInfo(msg.clientId, { hostHint });
        }
      });

      send(ws, { type: "history", messages: room.getHistory() });
      send(ws, { type: "members", members: room.getMembers() });
      broadcastMembers();
      return;
    }

    if (msg.type === "chat") {
      if (!state.joined || !state.clientId || !state.nickname) {
        send(ws, { type: "error", code: "NOT_JOINED", message: "请先加入聊天室" });
        return;
      }
      if (!room.isJoined(state.clientId, ws)) {
        send(ws, { type: "error", code: "NOT_JOINED", message: "连接已失效，请刷新" });
        return;
      }

      const text = sanitizeCaption(msg.text);
      if (text === null) {
        send(ws, { type: "error", code: "INVALID_TEXT", message: "消息不能为空或过长" });
        return;
      }
      const image = msg.image ? sanitizeImageUrl(msg.image) : null;
      if (msg.image && !image) {
        send(ws, { type: "error", code: "INVALID_IMAGE", message: "图片无效" });
        return;
      }
      if (image && !uploadExists(image)) {
        send(ws, { type: "error", code: "INVALID_IMAGE", message: "图片不存在或已过期" });
        return;
      }
      const parsedFile = acceptChatFile(msg.file);
      if (!parsedFile.ok) {
        send(ws, { type: "error", code: "INVALID_FILE", message: "文件无效" });
        return;
      }
      if (image && parsedFile.file) {
        send(ws, { type: "error", code: "INVALID_FILE", message: "不能同时发送图片和文件" });
        return;
      }
      if (!text && !image && !parsedFile.file) {
        send(ws, { type: "error", code: "INVALID_TEXT", message: "消息不能为空或过长" });
        return;
      }

      const message = room.addMessage(
        state.clientId,
        state.nickname,
        text,
        image,
        parsedFile.file
      );
      if (!message) {
        send(ws, {
          type: "error",
          code: "RATE_LIMIT",
          message: "发送过快，请稍后再试",
        });
        return;
      }

      store.appendMessage(message);
      broadcast({ type: "message", message });
      return;
    }

    send(ws, { type: "error", code: "UNKNOWN_TYPE", message: "未知消息类型" });
  });

  ws.on("close", () => {
    if (state.clientId && room.leave(state.clientId, ws)) {
      broadcastMembers();
    }
  });
});

app.use((err: { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err?.type === "entity.too.large" || err?.status === 413) {
    res.status(413).json({ error: "图片不能超过 10MB" });
    return;
  }
  next(err);
});

server.listen(PORT, HOST, () => {
  console.log(`Chat server listening on ${HOST}:${PORT} (all interfaces)`);
  console.log(`Data dir: ${store.getDataDir()}`);
  console.log(`Admin: http://127.0.0.1:${PORT}/admin/`);
});
