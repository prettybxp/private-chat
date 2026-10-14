import { createActivityReporter } from "./activity-tracker";
import { collectClientInfo } from "./client-info";
import { initTabAlert, notifyTabAlert } from "./tab-alert";
import type { ChatFile, Member, Message, Presence } from "./types";

type ServerPayload =
  | { type: "history"; messages: Message[] }
  | { type: "message"; message: Message }
  | { type: "members"; members: Member[] }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | { type: "uploaded"; uploadId: string; url: string; name?: string; size?: number };

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
const imageBtn = document.getElementById("image-btn")!;
const fileBtn = document.getElementById("file-btn")!;
const imageInput = document.getElementById("image-input") as HTMLInputElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const imagePreview = document.getElementById("image-preview")!;
const composerError = document.getElementById("composer-error")!;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]);

let pendingImage: File | null = null;
let pendingFile: File | null = null;
let pendingPreviewUrl = "";
let sending = false;
let uploadWait: {
  id: string;
  finish: (err?: Error, uploaded?: { url: string; name?: string; size?: number }) => void;
} | null = null;

const IMAGE_CHUNK_BYTES = 256 * 1024;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let joined = false;
let pendingClientInfo: Awaited<ReturnType<typeof collectClientInfo>> | null = null;
let activityReporter: ReturnType<typeof createActivityReporter> | null = null;

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "在线",
  idle: "离开",
  listening: "挂机",
};

const PRESENCE_HINT: Record<Presence, string> = {
  online: "正在看聊天",
  idle: "页面开着，但超过 2 分钟无鼠标/键盘操作",
  listening: "插件挂机",
};

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

function safeImagePath(url: string | undefined): string | null {
  if (!url) return null;
  return /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/.test(
    url
  )
    ? url
    : null;
}

function safeFile(file: ChatFile | undefined): ChatFile | null {
  if (!file) return null;
  if (
    !/^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(file.url)
  ) {
    return null;
  }
  if (!file.name || file.name.length > 80) return null;
  if (!Number.isInteger(file.size) || file.size < 1) return null;
  return file;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMessage(msg: Message): void {
  const clientId = getClientId();
  const isSelf = msg.clientId === clientId;
  const image = safeImagePath(msg.image);
  const file = safeFile(msg.file);
  const el = document.createElement("div");
  el.className = `msg${isSelf ? " self" : ""}`;
  el.dataset.id = msg.id;
  const imageHtml = image
    ? `<a href="${image}" target="_blank" rel="noopener"><img class="msg-image" src="${image}" alt="图片"></a>`
    : "";
  const fileHtml = file
    ? `<a class="msg-file" href="${file.url}?name=${encodeURIComponent(file.name)}" download="${escapeHtml(file.name)}"><span class="msg-file-name">${escapeHtml(file.name)}</span><span class="msg-file-size">${formatSize(file.size)}</span></a>`
    : "";
  const textHtml = msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : "";
  el.innerHTML = `
    <div class="msg-meta">
      <span class="msg-nick">${escapeHtml(msg.nickname)}</span>
      <time>${formatTime(msg.ts)}</time>
    </div>
    <div class="msg-bubble">${imageHtml}${fileHtml}${textHtml}</div>
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
  const onlineCount = members.filter((m) => m.presence === "online").length;
  const idleCount = members.filter((m) => m.presence === "idle").length;
  const listeningCount = members.filter((m) => m.presence === "listening").length;
  const parts: string[] = [];
  if (onlineCount) parts.push(`在线 ${onlineCount}`);
  if (idleCount) parts.push(`离开 ${idleCount}`);
  if (listeningCount) parts.push(`挂机 ${listeningCount}`);
  membersTitle.textContent = parts.length ? parts.join(" · ") : "在线 (0)";
  membersList.innerHTML = "";
  for (const m of members) {
    const presence: Presence = m.presence || "online";
    const li = document.createElement("li");
    li.className = [m.clientId === clientId ? "self" : "", presence].filter(Boolean).join(" ");
    li.innerHTML = `
      <span class="presence-dot" title="${PRESENCE_HINT[presence]}"></span>
      <span class="member-name">${escapeHtml(m.nickname)}</span>
      <span class="presence-label">${PRESENCE_LABEL[presence]}</span>
    `;
    membersList.appendChild(li);
  }
}

function startActivityTracking(): void {
  if (activityReporter) return;
  activityReporter = createActivityReporter((active) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "activity", active }));
    }
  });
  activityReporter.start();
}

function stopActivityTracking(): void {
  activityReporter?.stop();
  activityReporter = null;
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
      source: "page",
      clientInfo: pendingClientInfo || undefined,
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
        startActivityTracking();
        break;
      case "message":
        renderMessage(payload.message);
        scrollToBottom();
        if (payload.message.clientId !== getClientId()) {
          notifyTabAlert();
        }
        break;
      case "members":
        renderMembers(payload.members);
        break;
      case "error":
        if (uploadWait && payload.code === "UPLOAD_FAILED") {
          uploadWait.finish(new Error(payload.message));
          break;
        }
        if (!getCookie(COOKIE_NICKNAME)) {
          showModalError(payload.message);
        }
        break;
      case "uploaded":
        if (uploadWait && payload.uploadId === uploadWait.id) {
          uploadWait.finish(undefined, payload);
        }
        break;
      case "pong":
        break;
    }
  };

  ws.onclose = () => {
    joined = false;
    uploadWait?.finish(new Error("连接已断开，请稍后再发"));
    stopActivityTracking();
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

async function enterChat(nickname: string): Promise<void> {
  setCookie(COOKIE_NICKNAME, nickname.trim());
  modal.classList.add("hidden");
  chat.classList.remove("hidden");
  pendingClientInfo = await collectClientInfo();
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

function showComposerError(text: string): void {
  composerError.textContent = text;
  composerError.classList.remove("hidden");
}

function clearComposerError(): void {
  composerError.classList.add("hidden");
}

function clearPendingAttachment(): void {
  pendingImage = null;
  pendingFile = null;
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingPreviewUrl = "";
  imagePreview.classList.add("hidden");
  imagePreview.innerHTML = "";
  imageInput.value = "";
  fileInput.value = "";
}

function showPendingPreview(node: Node): void {
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "移除";
  remove.addEventListener("click", clearPendingAttachment);
  imagePreview.classList.remove("hidden");
  imagePreview.append(node, remove);
}

function setPendingImage(file: File): void {
  clearComposerError();
  if (file.type && !IMAGE_TYPES.has(file.type)) {
    showComposerError("仅支持 JPG、PNG、GIF、WebP");
    return;
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    showComposerError("图片不能超过 10MB");
    return;
  }
  clearPendingAttachment();
  pendingImage = file;
  pendingPreviewUrl = URL.createObjectURL(file);
  const img = document.createElement("img");
  img.src = pendingPreviewUrl;
  img.alt = "待发送图片";
  showPendingPreview(img);
}

function setPendingFile(file: File): void {
  clearComposerError();
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    showComposerError("文件不能超过 10MB");
    return;
  }
  clearPendingAttachment();
  pendingFile = file;
  const label = document.createElement("span");
  label.className = "msg-file-name";
  label.textContent = `${file.name || "未命名文件"} · ${formatSize(file.size)}`;
  showPendingPreview(label);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function uploadAttachment(
  file: File,
  kind: "image" | "file"
): Promise<{ url: string; name?: string; size?: number }> {
  const socket = ws;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("连接已断开，请稍后再发"));
  }
  const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const result = new Promise<{ url: string; name?: string; size?: number }>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("上传超时")), 60_000);
    function finish(err?: Error, uploaded?: { url: string; name?: string; size?: number }): void {
      clearTimeout(timer);
      if (uploadWait?.id !== uploadId) return;
      uploadWait = null;
      if (err || !uploaded?.url) reject(err || new Error("上传失败"));
      else resolve(uploaded);
    }
    uploadWait = { id: uploadId, finish };
  });

  void file.arrayBuffer().then(async (buf) => {
    const bytes = new Uint8Array(buf);
    if (!uploadWait || uploadWait.id !== uploadId || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "image-begin",
        uploadId,
        size: bytes.length,
        kind,
        name: kind === "file" ? file.name || "未命名文件" : undefined,
      })
    );
    let seq = 0;
    for (let offset = 0; offset < bytes.length; offset += IMAGE_CHUNK_BYTES) {
      if (uploadWait?.id !== uploadId || socket.readyState !== WebSocket.OPEN) return;
      const slice = bytes.subarray(offset, Math.min(offset + IMAGE_CHUNK_BYTES, bytes.length));
      socket.send(
        JSON.stringify({
          type: "image-chunk",
          uploadId,
          seq,
          data: bytesToBase64(slice),
        })
      );
      seq += 1;
      if (seq % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (uploadWait?.id === uploadId && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "image-end", uploadId }));
    }
  }).catch(() => {
    uploadWait?.finish(new Error("读取图片失败"));
  });

  return result;
}

imageBtn.addEventListener("click", () => imageInput.click());
fileBtn.addEventListener("click", () => fileInput.click());
imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) setPendingImage(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) setPendingFile(file);
});

function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const fromFiles = [...data.files].find((item) => item.type.startsWith("image/"));
  if (fromFiles) return fromFiles;
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const type = blob.type || item.type || "image/png";
    const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return new File([blob], blob.name || `paste.${ext}`, { type });
  }
  return null;
}

document.addEventListener("paste", (e) => {
  if (chat.classList.contains("hidden")) return;
  const file = imageFromClipboard(e.clipboardData);
  if (!file) return;
  e.preventDefault();
  setPendingImage(file);
  messageInput.focus();
});

composer.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});

composer.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  e.preventDefault();
  if (file.type.startsWith("image/") && (!file.type || IMAGE_TYPES.has(file.type))) {
    setPendingImage(file);
  } else {
    setPendingFile(file);
  }
});

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (sending || !joined || !ws || ws.readyState !== WebSocket.OPEN) return;

  const text = messageInput.value.trim();
  const imageFile = pendingImage;
  const attachment = pendingFile;
  if (!text && !imageFile && !attachment) return;

  sending = true;
  sendBtn.disabled = true;
  clearComposerError();
  try {
    const uploadedImage = imageFile ? await uploadAttachment(imageFile, "image") : undefined;
    const uploadedFile = attachment ? await uploadAttachment(attachment, "file") : undefined;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showComposerError("连接已断开，请稍后再发");
      return;
    }
    activityReporter?.ping();
    ws.send(
      JSON.stringify({
        type: "chat",
        text,
        image: uploadedImage?.url,
        file:
          uploadedFile?.url && uploadedFile.name && uploadedFile.size
            ? { url: uploadedFile.url, name: uploadedFile.name, size: uploadedFile.size }
            : undefined,
      })
    );
    messageInput.value = "";
    clearPendingAttachment();
  } catch (err) {
    showComposerError(err instanceof Error ? err.message : "图片上传失败");
  } finally {
    sending = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

function init(): void {
  initTabAlert();
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
