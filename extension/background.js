const DEFAULT_ORIGIN = "https://chat.ifbao.cn:6008";
const COOKIE_CLIENT_ID = "chat_client_id";
const COOKIE_NICKNAME = "chat_nickname";
const PING_MS = 20_000;

/** @type {WebSocket | null} */
let ws = null;
/** @type {ReturnType<typeof setInterval> | null} */
let pingTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let reconnectTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let cookieDebounce = null;
let reconnectAttempt = 0;
let joined = false;
let unread = 0;
/** @type {string | null} */
let joinedClientId = null;

async function getSettings() {
  const stored = await chrome.storage.local.get(["enabled", "origin"]);
  const origin = String(stored.origin || DEFAULT_ORIGIN).replace(/\/$/, "");
  return {
    enabled: stored.enabled !== false,
    origin: origin || DEFAULT_ORIGIN,
  };
}

function decodeCookie(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getIdentity(origin) {
  const [idCookie, nickCookie] = await Promise.all([
    chrome.cookies.get({ url: origin + "/", name: COOKIE_CLIENT_ID }),
    chrome.cookies.get({ url: origin + "/", name: COOKIE_NICKNAME }),
  ]);
  return {
    clientId: decodeCookie(idCookie?.value || ""),
    nickname: decodeCookie(nickCookie?.value || ""),
  };
}

function wsUrl(origin) {
  const u = new URL(origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  u.hash = "";
  return u.toString();
}

function isChatUrl(url, origin) {
  if (!url) return false;
  try {
    const a = new URL(url);
    const b = new URL(origin);
    if (a.origin !== b.origin) return false;
    return !a.pathname.startsWith("/admin");
  } catch {
    return false;
  }
}

async function chatPageIsFocused(origin) {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.focused) continue;
    const active = win.tabs?.find((t) => t.active);
    if (active?.url && isChatUrl(active.url, origin)) return true;
  }
  return false;
}

async function setStatus(status, message = "") {
  await chrome.storage.local.set({ status, statusMessage: message || "" });
  try {
    await chrome.runtime.sendMessage({ type: "status", status, message });
  } catch {
    /* popup 未打开 */
  }
}

async function updateBadge() {
  const text = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#5b8def" });
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function disconnect(clearReconnect = true) {
  if (clearReconnect && reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopPing();
  joined = false;
  joinedClientId = null;
  const socket = ws;
  ws = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function connect() {
  const { enabled, origin } = await getSettings();
  if (!enabled) {
    disconnect();
    await setStatus("off");
    return;
  }

  const { clientId, nickname } = await getIdentity(origin);
  if (!clientId || !nickname) {
    disconnect();
    await setStatus("need-login");
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  await setStatus("connecting");
  try {
    ws = new WebSocket(wsUrl(origin));
  } catch {
    await setStatus("error", "无法创建连接");
    scheduleReconnect();
    return;
  }

  const socket = ws;

  socket.onopen = () => {
    if (ws !== socket) return;
    reconnectAttempt = 0;
    socket.send(
      JSON.stringify({
        type: "join",
        clientId,
        nickname,
        source: "extension",
        clientInfo: { clientSource: "chrome-extension" },
      })
    );
    stopPing();
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_MS);
  };

  socket.onmessage = async (ev) => {
    if (ws !== socket) return;
    let payload;
    try {
      payload = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    if (payload.type === "history") {
      joined = true;
      joinedClientId = clientId;
      await setStatus("listening");
      return;
    }

    if (payload.type === "error") {
      await setStatus("error", payload.message || "连接被拒绝");
      return;
    }

    if (payload.type !== "message" || !joined) return;
    const msg = payload.message;
    if (!msg || msg.clientId === joinedClientId) return;

    const { origin: curOrigin } = await getSettings();
    if (await chatPageIsFocused(curOrigin)) return;

    unread += 1;
    await updateBadge();
    await chrome.notifications.create(`chat-${msg.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: String(msg.nickname || "新消息"),
      message:
        String(msg.text || "").slice(0, 200) ||
        (msg.image ? "[图片]" : msg.file?.name ? `[文件] ${msg.file.name}` : "（空消息）"),
      priority: 1,
    });
  };

  socket.onclose = async () => {
    if (ws === socket) ws = null;
    stopPing();
    joined = false;
    joinedClientId = null;
    const { enabled: stillOn } = await getSettings();
    if (stillOn) {
      await setStatus("reconnecting");
      scheduleReconnect();
    } else {
      await setStatus("off");
    }
  };

  socket.onerror = () => {
    socket.close();
  };
}

async function openChat() {
  const { origin } = await getSettings();
  unread = 0;
  await updateBadge();
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const chatTab = tabs.find((t) => t.url && !String(t.url).includes("/admin"));
  if (chatTab?.id) {
    await chrome.tabs.update(chatTab.id, { active: true });
    if (chatTab.windowId != null) {
      await chrome.windows.update(chatTab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: `${origin}/` });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keep-ws", { periodInMinutes: 1 });
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keep-ws", { periodInMinutes: 1 });
  connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep-ws") connect();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.origin) {
    disconnect();
    connect();
  }
});

chrome.cookies.onChanged.addListener((change) => {
  const name = change.cookie?.name;
  if (name !== COOKIE_CLIENT_ID && name !== COOKIE_NICKNAME) return;
  if (cookieDebounce) clearTimeout(cookieDebounce);
  cookieDebounce = setTimeout(() => {
    cookieDebounce = null;
    disconnect();
    connect();
  }, 400);
});

chrome.notifications.onClicked.addListener(async () => {
  await openChat();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "get-state") {
    (async () => {
      const settings = await getSettings();
      const identity = await getIdentity(settings.origin);
      const stored = await chrome.storage.local.get(["status", "statusMessage"]);
      sendResponse({
        ...settings,
        ...identity,
        status: stored.status || "off",
        statusMessage: stored.statusMessage || "",
        connected: Boolean(joined && ws?.readyState === WebSocket.OPEN),
        unread,
      });
    })();
    return true;
  }

  if (msg?.type === "set-enabled") {
    chrome.storage.local.set({ enabled: Boolean(msg.enabled) }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "set-origin") {
    const origin = String(msg.origin || "").replace(/\/$/, "");
    chrome.storage.local.set({ origin: origin || DEFAULT_ORIGIN }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "open-chat") {
    openChat().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "clear-unread") {
    unread = 0;
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.alarms.create("keep-ws", { periodInMinutes: 1 });
connect();
