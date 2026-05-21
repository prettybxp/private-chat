import WebSocket from "ws";

const BASE = process.env.BASE || "http://127.0.0.1:8088";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

function connect(clientId, nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { history: null, members: null, messages: [] };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", clientId, nickname }));
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

function waitMembersCount(ws, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("members timeout")), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "members" && msg.members.length === count) {
        clearTimeout(t);
        ws.off("message", handler);
        resolve(msg.members);
      }
    };
    ws.on("message", handler);
  });
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
  if (b.state.members.length !== 2) {
    throw new Error(`expected 2 members, got ${b.state.members.length}`);
  }

  a.ws.send(JSON.stringify({ type: "chat", text: "你好" }));
  const received = await waitMessage(b.ws);
  if (received.text !== "你好") throw new Error("message mismatch");

  // 3. 断线后成员减少
  const membersAfterLeave = waitMembersCount(a.ws, 1);
  b.ws.close();
  const left = await membersAfterLeave;
  if (left.length !== 1) throw new Error("member count after leave");

  a.ws.close();
  console.log("All verification checks passed.");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e.message);
  process.exit(1);
});
