import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { Member, Message } from "./protocol.js";

const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT_PER_SEC = 5;

type MemberEntry = {
  nickname: string;
  ws: WebSocket;
};

export class Room {
  private messages: Message[] = [];
  private members = new Map<string, MemberEntry>();
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();

  join(clientId: string, nickname: string, ws: WebSocket): void {
    const existing = this.members.get(clientId);
    if (existing && existing.ws !== ws) {
      try {
        existing.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.members.set(clientId, { nickname, ws });
  }

  leave(clientId: string, ws: WebSocket): boolean {
    const entry = this.members.get(clientId);
    if (!entry || entry.ws !== ws) return false;
    this.members.delete(clientId);
    return true;
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getMembers(): Member[] {
    const nicknames = new Map<string, number>();
    for (const { nickname } of this.members.values()) {
      nicknames.set(nickname, (nicknames.get(nickname) ?? 0) + 1);
    }

    const result: Member[] = [];
    for (const [clientId, { nickname }] of this.members) {
      const duplicate = (nicknames.get(nickname) ?? 0) > 1;
      result.push({
        clientId,
        nickname: duplicate
          ? `${nickname}#${clientId.slice(-4)}`
          : nickname,
      });
    }
    return result.sort((a, b) => a.nickname.localeCompare(b.nickname, "zh"));
  }

  addMessage(clientId: string, nickname: string, text: string): Message | null {
    if (!this.checkRateLimit(clientId)) return null;

    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return null;

    const message: Message = {
      id: randomUUID(),
      clientId,
      nickname,
      text: trimmed,
      ts: Date.now(),
    };

    this.messages.push(message);
    while (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }
    return message;
  }

  isJoined(clientId: string, ws: WebSocket): boolean {
    const entry = this.members.get(clientId);
    return entry !== undefined && entry.ws === ws;
  }

  getNickname(clientId: string): string | undefined {
    return this.members.get(clientId)?.nickname;
  }

  forEachSocket(fn: (ws: WebSocket) => void): void {
    for (const { ws } of this.members.values()) {
      if (ws.readyState === ws.OPEN) fn(ws);
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

export function sanitizeNickname(raw: string): string | null {
  const trimmed = raw.trim().replace(/<[^>]*>/g, "");
  if (trimmed.length < 1 || trimmed.length > 20) return null;
  return trimmed;
}

export function sanitizeText(raw: string): string | null {
  const trimmed = raw.trim().replace(/<[^>]*>/g, "");
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return null;
  return trimmed;
}
