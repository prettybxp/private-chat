import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { ChatFile, ConnectionSource, Member, Message, Presence } from "./protocol.js";

const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT_PER_SEC = 5;

type ConnectionMeta = {
  source: ConnectionSource;
  /** 仅 page 连接有效；extension 忽略 */
  active: boolean;
};

type MemberEntry = {
  nickname: string;
  connections: Map<WebSocket, ConnectionMeta>;
};

export class Room {
  private messages: Message[] = [];
  private members = new Map<string, MemberEntry>();
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();

  /** 同一 clientId 允许多个连接（多标签页 + 插件），不再踢掉旧连接 */
  join(
    clientId: string,
    nickname: string,
    ws: WebSocket,
    source: ConnectionSource = "page"
  ): void {
    let entry = this.members.get(clientId);
    if (!entry) {
      entry = { nickname, connections: new Map() };
      this.members.set(clientId, entry);
    } else {
      entry.nickname = nickname;
    }
    entry.connections.set(ws, {
      source,
      active: source === "page",
    });
  }

  setActivity(ws: WebSocket, active: boolean): string | null {
    for (const [clientId, entry] of this.members) {
      const meta = entry.connections.get(ws);
      if (!meta || meta.source !== "page") continue;
      const before = presenceOf(entry);
      meta.active = active;
      const after = presenceOf(entry);
      return before !== after ? clientId : null;
    }
    return null;
  }

  leave(clientId: string, ws: WebSocket): boolean {
    const entry = this.members.get(clientId);
    if (!entry || !entry.connections.has(ws)) return false;
    entry.connections.delete(ws);
    if (entry.connections.size === 0) {
      this.members.delete(clientId);
    }
    return true;
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  loadHistory(messages: Message[]): void {
    this.messages = messages.slice(-MAX_MESSAGES);
  }

  clearHistory(): void {
    this.messages = [];
  }

  getMembers(): Member[] {
    const nicknames = new Map<string, number>();
    for (const { nickname } of this.members.values()) {
      nicknames.set(nickname, (nicknames.get(nickname) ?? 0) + 1);
    }

    const result: Member[] = [];
    for (const [clientId, entry] of this.members) {
      const duplicate = (nicknames.get(entry.nickname) ?? 0) > 1;
      result.push({
        clientId,
        nickname: duplicate
          ? `${entry.nickname}#${clientId.slice(-4)}`
          : entry.nickname,
        presence: presenceOf(entry),
      });
    }
    return result.sort((a, b) => {
      const rank = (p: Presence) => (p === "online" ? 0 : p === "idle" ? 1 : 2);
      const d = rank(a.presence) - rank(b.presence);
      if (d !== 0) return d;
      return a.nickname.localeCompare(b.nickname, "zh");
    });
  }

  addMessage(
    clientId: string,
    nickname: string,
    text: string,
    image: string | null = null,
    file: ChatFile | null = null
  ): Message | null {
    if (!this.checkRateLimit(clientId)) return null;
    if (image && file) return null;
    if ((!text && !image && !file) || text.length > MAX_TEXT_LENGTH) return null;

    const message: Message = {
      id: randomUUID(),
      clientId,
      nickname,
      text,
      ts: Date.now(),
      ...(image ? { image } : {}),
      ...(file ? { file } : {}),
    };

    this.messages.push(message);
    while (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }
    return message;
  }

  isJoined(clientId: string, ws: WebSocket): boolean {
    const entry = this.members.get(clientId);
    return entry !== undefined && entry.connections.has(ws);
  }

  getNickname(clientId: string): string | undefined {
    return this.members.get(clientId)?.nickname;
  }

  forEachSocket(fn: (ws: WebSocket) => void): void {
    for (const { connections } of this.members.values()) {
      for (const ws of connections.keys()) {
        if (ws.readyState === ws.OPEN) fn(ws);
      }
    }
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    let bucket = this.rateBuckets.get(clientId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + 1000 };
      this.rateBuckets.set(clientId, bucket);
    }
    bucket.count++;
    return bucket.count <= RATE_LIMIT_PER_SEC;
  }
}

export const room = new Room();

function presenceOf(entry: MemberEntry): Presence {
  let hasPage = false;
  let hasActivePage = false;
  for (const meta of entry.connections.values()) {
    if (meta.source === "page") {
      hasPage = true;
      if (meta.active) hasActivePage = true;
    }
  }
  if (hasActivePage) return "online";
  if (hasPage) return "idle";
  return "listening";
}

export function sanitizeSource(raw: unknown): ConnectionSource {
  return raw === "extension" ? "extension" : "page";
}

export function sanitizeNickname(raw: string): string | null {
  const trimmed = raw.trim().replace(/<[^>]*>/g, "");
  if (trimmed.length < 1 || trimmed.length > 20) return null;
  return trimmed;
}

/** 图片消息允许空文字；过长返回 null */
export function sanitizeCaption(raw: unknown): string | null {
  if (raw == null) return "";
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/<[^>]*>/g, "");
  if (trimmed.length > MAX_TEXT_LENGTH) return null;
  return trimmed;
}

export function sanitizeText(raw: string): string | null {
  const trimmed = sanitizeCaption(raw);
  if (!trimmed) return null;
  return trimmed;
}
