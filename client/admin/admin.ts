type Message = {
  id: string;
  clientId: string;
  nickname: string;
  text: string;
  ts: number;
};

type UserRecord = {
  clientId: string;
  nickname: string;
  firstSeen: number;
  lastSeen: number;
  joinCount: number;
  clientInfo: Record<string, unknown>;
};

const loginView = document.getElementById("login-view")!;
const appView = document.getElementById("app-view")!;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const loginError = document.getElementById("login-error")!;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const logoutBtn = document.getElementById("logout-btn")!;
const messagesBody = document.getElementById("messages-body")!;
const pageInfo = document.getElementById("page-info")!;
const usersList = document.getElementById("users-list")!;

let currentPage = 1;
const pageSize = 30;

async function api(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
}

function showLogin(): void {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showApp(): void {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLocalIps(info: Record<string, unknown>): string {
  const ips = info.localIps;
  if (Array.isArray(ips) && ips.length) return ips.join(", ");
  return "未获取";
}

async function checkSession(): Promise<boolean> {
  const res = await api("/api/admin/me");
  return res.ok;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const res = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: passwordInput.value }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    loginError.textContent = data.error || "登录失败";
    loginError.classList.remove("hidden");
    return;
  }
  showApp();
  await loadMessages();
  await loadUsers();
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  showLogin();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = (btn as HTMLButtonElement).dataset.tab;
    document.getElementById("tab-messages")!.classList.toggle("hidden", tab !== "messages");
    document.getElementById("tab-users")!.classList.toggle("hidden", tab !== "users");
  });
});

async function loadMessages(): Promise<void> {
  const nickname = (document.getElementById("filter-nickname") as HTMLInputElement).value.trim();
  const fromEl = document.getElementById("filter-from") as HTMLInputElement;
  const toEl = document.getElementById("filter-to") as HTMLInputElement;
  const params = new URLSearchParams({
    page: String(currentPage),
    pageSize: String(pageSize),
  });
  if (nickname) params.set("nickname", nickname);
  if (fromEl.value) params.set("from", String(new Date(fromEl.value).getTime()));
  if (toEl.value) params.set("to", String(new Date(toEl.value).getTime()));

  const res = await api(`/api/admin/messages?${params}`);
  if (!res.ok) return;
  const data = (await res.json()) as {
    items: Message[];
    total: number;
    page: number;
    pageSize: number;
  };

  messagesBody.innerHTML = "";
  for (const m of data.items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(formatTs(m.ts))}</td>
      <td>${escapeHtml(m.nickname)}</td>
      <td><code>${escapeHtml(m.clientId.slice(0, 8))}…</code></td>
      <td>${escapeHtml(m.text)}</td>
    `;
    messagesBody.appendChild(tr);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  pageInfo.textContent = `第 ${data.page} / ${totalPages} 页，共 ${data.total} 条`;
}

document.getElementById("filter-btn")!.addEventListener("click", () => {
  currentPage = 1;
  loadMessages();
});

document.getElementById("prev-page")!.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadMessages();
  }
});

document.getElementById("next-page")!.addEventListener("click", () => {
  currentPage++;
  loadMessages();
});

async function loadUsers(): Promise<void> {
  const res = await api("/api/admin/users");
  if (!res.ok) return;
  const data = (await res.json()) as { users: UserRecord[] };
  usersList.innerHTML = "";

  for (const u of data.users) {
    const info = u.clientInfo || {};
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = `
      <h3>${escapeHtml(u.nickname)}</h3>
      <div class="user-meta">
        <div><strong>连接 IP</strong> ${escapeHtml(String(info.remoteIp || "—"))}</div>
        <div><strong>本机 IP（探测）</strong> ${escapeHtml(formatLocalIps(info))}</div>
        <div><strong>主机名提示</strong> ${escapeHtml(String(info.hostHint || "—"))}</div>
        <div>用户ID <code>${escapeHtml(u.clientId)}</code></div>
        <div>加入 ${u.joinCount} 次 · 首次 ${formatTs(u.firstSeen)} · 最近 ${formatTs(u.lastSeen)}</div>
      </div>
      <pre class="user-json">${escapeHtml(JSON.stringify(info, null, 2))}</pre>
    `;
    usersList.appendChild(card);
  }
}

(async () => {
  if (await checkSession()) {
    showApp();
    await loadMessages();
    await loadUsers();
  } else {
    showLogin();
  }
})();
