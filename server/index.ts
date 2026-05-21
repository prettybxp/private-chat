import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerPayload } from "./protocol.js";
import { room, sanitizeNickname, sanitizeText } from "./room.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8088;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const isProd = process.env.NODE_ENV === "production";
const clientStatic = isProd
  ? path.join(__dirname, "../client")
  : null;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

if (clientStatic) {
  app.use(express.static(clientStatic));
  app.get("*", (_req, res) => {
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

wss.on("connection", (ws) => {
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

      state.clientId = msg.clientId;
      state.nickname = validNickname;
      state.joined = true;
      room.join(msg.clientId, validNickname, ws);

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
});
