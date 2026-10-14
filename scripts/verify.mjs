import WebSocket from "ws";

const BASE = process.env.BASE || "http://127.0.0.1:8088";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

function connect(clientId, nickname, source = "page") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { history: null, members: null, messages: [] };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", clientId, nickname, source }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "history") state.history = msg.messages;
      if (msg.type === "members") state.members = msg.members;
      if (msg.type === "message") state.messages.push(msg.message);
      if (state.history !== null && state.members !== null) {
        resolve({ ws, state });
      }
    });

    ws.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function waitMembers(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("members timeout")), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "members" && predicate(msg.members)) {
        clearTimeout(t);
        ws.off("message", handler);
        resolve(msg.members);
      }
    };
    ws.on("message", handler);
  });
}

function waitMembersCount(ws, count, timeout = 5000) {
  return waitMembers(ws, (members) => members.length === count, timeout);
}

function waitMessage(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("message timeout")), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "message") {
        clearTimeout(t);
        ws.off("message", handler);
        resolve(msg.message);
      }
    };
    ws.on("message", handler);
  });
}

function fetchHistory(clientId, nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", clientId, nickname }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "history") {
        resolve(msg.messages);
        ws.close();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("history timeout")), 5000);
  });
}

async function main() {
  const health = await fetch(BASE + "/health").then((r) => r.json());
  if (!health.ok) throw new Error("health check failed");

  const id1 = "11111111-1111-1111-1111-111111111111";
  const id2 = "22222222-2222-2222-2222-222222222222";
  const id3 = "33333333-3333-3333-3333-333333333333";

  // 1. 100 条历史上限（干净连接，无其它消息干扰）
  const solo = await connect(id3, "测试员");
  for (let i = 0; i < 101; i++) {
    solo.ws.send(JSON.stringify({ type: "chat", text: `msg-${i}` }));
    await new Promise((r) => setTimeout(r, 220));
  }
  solo.ws.close();

  const hist = await fetchHistory(id3, "测试员");
  if (hist.length !== 100) {
    throw new Error(`expected 100 history messages, got ${hist.length}`);
  }
  const tagged = hist.filter((m) => /^msg-\d+$/.test(m.text));
  const nums = tagged.map((m) => Number(m.text.slice(4)));
  if (tagged.length !== 100 || Math.min(...nums) !== 1 || Math.max(...nums) !== 100) {
    throw new Error(
      `buffer should keep msg-1..msg-100, got range ${Math.min(...nums)}-${Math.max(...nums)} count=${tagged.length}`
    );
  }

  // 2. 双人在线与消息
  const a = await connect(id1, "用户A");
  const b = await connect(id2, "用户B");
  const has = (members, id) => members.some((m) => m.clientId === id);
  if (!has(b.state.members, id1) || !has(b.state.members, id2)) {
    throw new Error("expected both test members online");
  }
  const testPages = b.state.members.filter((m) => m.clientId === id1 || m.clientId === id2);
  if (!testPages.every((m) => m.presence === "online")) {
    throw new Error("page joins should be presence=online");
  }

  a.ws.send(JSON.stringify({ type: "chat", text: "你好" }));
  const received = await waitMessage(b.ws);
  if (received.text !== "你好") throw new Error("message mismatch");

  // 3. 断线后测试成员消失
  const membersAfterLeave = waitMembers(a.ws, (members) => !has(members, id2));
  b.ws.close();
  const left = await membersAfterLeave;
  if (has(left, id2)) throw new Error("member still listed after leave");

  a.ws.close();

  // 4. 页面在线 vs 插件挂机
  const id4 = "44444444-4444-4444-4444-444444444444";
  const pageA = await connect(id1, "用户A");
  const extA = await connect(id1, "用户A", "extension");
  const sameUser = extA.state.members.find((m) => m.clientId === id1);
  if (!sameUser || sameUser.presence !== "online") {
    throw new Error("page+extension should stay online");
  }
  if (extA.state.members.filter((m) => m.clientId === id1).length !== 1) {
    throw new Error("same clientId must appear once");
  }

  const extOnly = await connect(id4, "挂机用户", "extension");
  const hanging = extOnly.state.members.find((m) => m.clientId === id4);
  if (!hanging || hanging.presence !== "listening") {
    throw new Error("extension-only should be listening");
  }

  const afterPageClose = waitMembers(
    extA.ws,
    (members) => members.find((m) => m.clientId === id1)?.presence === "listening"
  );
  pageA.ws.close();
  await afterPageClose;

  const afterExtClose = waitMembers(extOnly.ws, (members) => !has(members, id1));
  extA.ws.close();
  const leftListening = await afterExtClose;
  const stillHanging = leftListening.find((m) => m.clientId === id4);
  if (!stillHanging || stillHanging.presence !== "listening") {
    throw new Error("extension member should remain listening");
  }
  extOnly.ws.close();

  // 5. 长时间无操作 -> 离开
  const idleConn = await connect(id1, "用户A");
  const becameIdle = waitMembers(
    idleConn.ws,
    (members) => members.find((m) => m.clientId === id1)?.presence === "idle"
  );
  idleConn.ws.send(JSON.stringify({ type: "activity", active: false }));
  await becameIdle;
  idleConn.ws.close();

  // 6. 图片上传并作为消息发出
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const denied = await fetch(BASE + "/api/upload", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (denied.status !== 401) throw new Error(`upload without cookie expected 401, got ${denied.status}`);

  const uploaded = await fetch(BASE + "/api/upload", {
    method: "POST",
    headers: { "Content-Type": "image/png", Cookie: "chat_nickname=tester" },
    body: png,
  });
  if (!uploaded.ok) throw new Error(`upload failed ${uploaded.status}`);
  const uploadedBody = await uploaded.json();
  if (!uploadedBody.url?.startsWith("/uploads/")) throw new Error("upload url missing");

  const imgClient = await connect("55555555-5555-5555-5555-555555555555", "图片测试");
  const imageMsg = waitMessage(imgClient.ws);
  imgClient.ws.send(JSON.stringify({ type: "chat", text: "看图", image: uploadedBody.url }));
  const gotImage = await imageMsg;
  if (gotImage.text !== "看图" || gotImage.image !== uploadedBody.url) {
    throw new Error("image message mismatch");
  }
  const fileRes = await fetch(BASE + uploadedBody.url);
  if (!fileRes.ok) throw new Error("uploaded image not served");
  imgClient.ws.close();

  console.log("All verification checks passed.");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e.message);
  process.exit(1);
});
