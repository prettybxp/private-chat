#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

NODE="/tmp/node-v20.18.1-linux-x64/bin/node"
PID_FILE="$ROOT/chat.pid"
LOG_FILE="$ROOT/chat.log"

if [[ ! -x "$NODE" ]]; then
  echo "错误: 未找到 Node: $NODE"
  echo "请安装 Node 20 或修改 start.sh 中的 NODE 路径。"
  exit 1
fi

if [[ ! -f "$ROOT/dist/server/index.js" ]]; then
  echo "错误: 未找到 dist/server/index.js，请先执行: npm run build"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "聊天室已在运行 (PID $OLD_PID)"
    echo "访问: http://127.0.0.1:8088"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

export NODE_ENV=production
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8088}"

nohup "$NODE" dist/server/index.js >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

sleep 1
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "启动失败，请查看日志: $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

echo "聊天室已后台启动 (PID $(cat "$PID_FILE"))"
echo "日志: $LOG_FILE"
echo "本机访问: http://127.0.0.1:${PORT}"
echo "局域网访问: http://<本机IP>:${PORT}"
