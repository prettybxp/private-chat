import express from "express";
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
import { room, sanitizeNickname, sanitizeText } from "./room.js";
import * as store from "./store.js";

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

      const serverInfo = buildServerClientInfo(req);
      const clientPart = sanitizeClientInfo(msg.clientInfo);
      const merged = mergeClientInfo(serverInfo, clientPart);

      state.clientId = msg.clientId;
      state.nickname = validNickname;
      state.joined = true;
      room.join(msg.clientId, validNickname, ws);

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

      const text = sanitizeText(msg.text);
      if (!text) {
        send(ws, { type: "error", code: "INVALID_TEXT", message: "消息不能为空或过长" });
        return;
      }

      const message = room.addMessage(state.clientId, state.nickname, text);
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

server.listen(PORT, HOST, () => {
  console.log(`Chat server listening on ${HOST}:${PORT} (all interfaces)`);
  console.log(`Data dir: ${store.getDataDir()}`);
  console.log(`Admin: http://127.0.0.1:${PORT}/admin/`);
});
