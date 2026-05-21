import fs from "fs";
import path from "path";
import type { ClientInfo, Message } from "./protocol.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.jsonl");
const USERS_FILE = path.join(DATA_DIR, "users.json");

export type UserRecord = {
  clientId: string;
  nickname: string;
  firstSeen: number;
  lastSeen: number;
  joinCount: number;
  clientInfo: ClientInfo;
};

type UsersDb = Record<string, UserRecord>;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readUsersDb(): UsersDb {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) as UsersDb;
  } catch {
    return {};
  }
}

function writeUsersDb(db: UsersDb): void {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), "utf8");
}

export function appendMessage(msg: Message): void {
  ensureDataDir();
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(msg) + "\n", "utf8");
}

export function upsertUser(
  clientId: string,
  nickname: string,
  clientInfo: ClientInfo
): void {
  const db = readUsersDb();
  const now = Date.now();
  const existing = db[clientId];
  if (existing) {
    existing.nickname = nickname;
    existing.lastSeen = now;
    existing.joinCount += 1;
    existing.clientInfo = { ...existing.clientInfo, ...clientInfo };
  } else {
    db[clientId] = {
      clientId,
      nickname,
      firstSeen: now,
      lastSeen: now,
      joinCount: 1,
      clientInfo,
    };
  }
  writeUsersDb(db);
}

export function patchUserClientInfo(
  clientId: string,
  patch: Partial<ClientInfo>
): void {
  const db = readUsersDb();
  const user = db[clientId];
  if (!user) return;
  user.clientInfo = { ...user.clientInfo, ...patch } as ClientInfo;
  user.lastSeen = Date.now();
  writeUsersDb(db);
}

export function loadRecentMessages(limit: number): Message[] {
  ensureDataDir();
  if (!fs.existsSync(MESSAGES_FILE)) return [];
  const content = fs.readFileSync(MESSAGES_FILE, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  const messages: Message[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      messages.push(JSON.parse(line) as Message);
    } catch {
      /* skip bad line */
    }
  }
  return messages;
}

export type MessageQuery = {
  page?: number;
  pageSize?: number;
  nickname?: string;
  from?: number;
  to?: number;
};

export function listMessages(query: MessageQuery = {}): {
  items: Message[];
  total: number;
  page: number;
  pageSize: number;
} {
  ensureDataDir();
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 50));

  let all: Message[] = [];
  if (fs.existsSync(MESSAGES_FILE)) {
    const content = fs.readFileSync(MESSAGES_FILE, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        all.push(JSON.parse(line) as Message);
      } catch {
        /* skip */
      }
    }
  }

  if (query.nickname) {
    all = all.filter((m) => m.nickname.includes(query.nickname!));
  }
  if (query.from) {
    all = all.filter((m) => m.ts >= query.from!);
  }
  if (query.to) {
    all = all.filter((m) => m.ts <= query.to!);
  }

  all.sort((a, b) => b.ts - a.ts);
  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);
  return { items, total, page, pageSize };
}

export function listUsers(): UserRecord[] {
  const db = readUsersDb();
  return Object.values(db).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getUser(clientId: string): UserRecord | null {
  return readUsersDb()[clientId] || null;
}

export function getDataDir(): string {
  return DATA_DIR;
}
