const statusEl = document.getElementById("status");
const enabledEl = document.getElementById("enabled");
const originEl = document.getElementById("origin");
const identityEl = document.getElementById("identity");
const openBtn = document.getElementById("open-chat");
const saveBtn = document.getElementById("save-origin");

const STATUS_TEXT = {
  listening: "已连接 · 插件挂机中",
  connecting: "正在连接…",
  reconnecting: "连接断开，正在重连…",
  "need-login": "请先打开聊天页并填写昵称",
  off: "已关闭后台听消息",
  error: "连接失败",
};

function renderStatus(status, message) {
  statusEl.className = "status";
  if (status === "listening") statusEl.classList.add("ok");
  else if (status === "need-login" || status === "reconnecting" || status === "connecting") {
    statusEl.classList.add("warn");
  } else if (status === "error") statusEl.classList.add("error");

  const base = STATUS_TEXT[status] || "检查中…";
  statusEl.textContent = message && status === "error" ? `${base}：${message}` : base;
}

async function loadState() {
  const state = await chrome.runtime.sendMessage({ type: "get-state" });
  enabledEl.checked = state.enabled !== false;
  originEl.value = state.origin || "";
  renderStatus(state.status, state.statusMessage);
  if (state.nickname) {
    identityEl.textContent = `当前身份：${state.nickname}`;
  } else {
    identityEl.textContent = "尚未在网页进入聊天室";
  }
  chrome.runtime.sendMessage({ type: "clear-unread" });
}

enabledEl.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({ type: "set-enabled", enabled: enabledEl.checked });
  setTimeout(loadState, 200);
});

saveBtn.addEventListener("click", async () => {
  const origin = originEl.value.trim().replace(/\/$/, "");
  if (!origin) return;
  try {
    await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    /* 已有权限或用户拒绝，仍尝试保存 */
  }
  await chrome.runtime.sendMessage({ type: "set-origin", origin });
  setTimeout(loadState, 200);
});

openBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "open-chat" });
  window.close();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "status") renderStatus(msg.status, msg.message);
});

loadState();
