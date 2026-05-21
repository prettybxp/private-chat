import type { Member, Message } from "./types";

type ServerPayload =
  | { type: "history"; messages: Message[] }
  | { type: "message"; message: Message }
  | { type: "members"; members: Member[] }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

const COOKIE_CLIENT_ID = "chat_client_id";
const COOKIE_NICKNAME = "chat_nickname";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const modal = document.getElementById("modal")!;
const chat = document.getElementById("chat")!;
const nicknameInput = document.getElementById("nickname-input") as HTMLInputElement;
const nicknameSubmit = document.getElementById("nickname-submit")!;
const modalError = document.getElementById("modal-error")!;
const banner = document.getElementById("banner")!;
const messagesEl = document.getElementById("messages")!;
const membersTitle = document.getElementById("members-title")!;
const membersList = document.getElementById("members-list")!;
const composer = document.getElementById("composer") as HTMLFormElement;
const messageInput = document.getElementById("message-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let joined = false;

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** 非 localhost 的 HTTP 页面没有 crypto.randomUUID，需回退 */
function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getClientId(): string {
  let id = getCookie(COOKIE_CLIENT_ID);
  if (!id) {
    id = createClientId();
    setCookie(COOKIE_CLIENT_ID, id);
  }
  return id;
}

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function showModalError(text: string): void {
  modalError.textContent = text;
  modalError.classList.remove("hidden");
}

function clearModalError(): void {
  modalError.classList.add("hidden");
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderMessage(msg: Message): void {
  const clientId = getClientId();
  const isSelf = msg.clientId === clientId;
  const el = document.createElement("div");
  el.className = `msg${isSelf ? " self" : ""}`;
  el.dataset.id = msg.id;
  el.innerHTML = `
    <div class="msg-meta">
      <span class="msg-nick">${escapeHtml(msg.nickname)}</span>
      <time>${formatTime(msg.ts)}</time>
    </div>
    <div class="msg-bubble">${escapeHtml(msg.text)}</div>
  `;
  messagesEl.appendChild(el);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scrollToBottom(): void {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderHistory(messages: Message[]): void {
  messagesEl.innerHTML = "";
  for (const msg of messages) renderMessage(msg);
  scrollToBottom();
}

function renderMembers(members: Member[]): void {
  const clientId = getClientId();
  membersTitle.textContent = `在线 (${members.length})`;
  membersList.innerHTML = "";
  for (const m of members) {
    const li = document.createElement("li");
    if (m.clientId === clientId) li.classList.add("self");
    li.textContent = m.nickname;
    membersList.appendChild(li);
  }
}

function setBannerVisible(visible: boolean): void {
  banner.classList.toggle("hidden", !visible);
}

function sendJoin(): void {
  const nickname = getCookie(COOKIE_NICKNAME);
  if (!nickname || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: "join",
      clientId: getClientId(),
      nickname,
    })
  );
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  joined = false;
  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectAttempt = 0;
    setBannerVisible(false);
    sendJoin();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  };

  ws.onmessage = (ev) => {
    let payload: ServerPayload;
    try {
      payload = JSON.parse(ev.data as string) as ServerPayload;
    } catch {
      return;
    }

    switch (payload.type) {
      case "history":
        joined = true;
        renderHistory(payload.messages);
        break;
      case "message":
        renderMessage(payload.message);
        scrollToBottom();
        break;
      case "members":
        renderMembers(payload.members);
        break;
      case "error":
        if (!getCookie(COOKIE_NICKNAME)) {
          showModalError(payload.message);
        }
        break;
      case "pong":
        break;
    }
  };

  ws.onclose = () => {
    joined = false;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    setBannerVisible(true);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function enterChat(nickname: string): void {
  setCookie(COOKIE_NICKNAME, nickname.trim());
  modal.classList.add("hidden");
  chat.classList.remove("hidden");
  connect();
}

function submitNickname(): void {
  clearModalError();
  const raw = nicknameInput.value.trim();
  if (raw.length < 1 || raw.length > 20) {
    showModalError("昵称须为 1–20 个字符");
    return;
  }
  enterChat(raw);
}

nicknameSubmit.addEventListener("click", submitNickname);
nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitNickname();
});

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!joined || !ws || ws.readyState !== WebSocket.OPEN) return;

  const text = messageInput.value.trim();
  if (!text) return;

  sendBtn.disabled = true;
  ws.send(JSON.stringify({ type: "chat", text }));
  messageInput.value = "";
  sendBtn.disabled = false;
  messageInput.focus();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

function init(): void {
  getClientId();
  const nickname = getCookie(COOKIE_NICKNAME);
  if (nickname) {
    enterChat(nickname);
  } else {
    modal.classList.remove("hidden");
    nicknameInput.focus();
  }
}

init();
