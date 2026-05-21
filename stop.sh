#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/chat.pid"
PORT="${PORT:-8088}"

stopped=0

stop_pid() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "已停止聊天室 (PID $pid)"
    stopped=1
  fi
}

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    stop_pid "$PID"
  else
    echo "PID 文件中的进程 $PID 已不存在。"
  fi
  rm -f "$PID_FILE"
fi

# 按端口查找孤儿进程（PID 文件过期时）
if command -v fuser >/dev/null 2>&1; then
  if fuser "${PORT}/tcp" >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
    sleep 1
    echo "已释放端口 ${PORT}"
    stopped=1
  fi
elif command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti ":${PORT}" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "$PIDS" | xargs -r kill 2>/dev/null || true
    sleep 1
    echo "$PIDS" | xargs -r kill -9 2>/dev/null || true
    echo "已释放端口 ${PORT}"
    stopped=1
  fi
else
  # 匹配本项目的 node 进程
  while read -r pid; do
    [[ -n "$pid" ]] && stop_pid "$pid"
  done < <(pgrep -f "${ROOT}/dist/server/index.js" 2>/dev/null || true)
fi

if [[ "$stopped" -eq 0 ]]; then
  if netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    echo "端口 ${PORT} 仍被占用，请手动检查: netstat -tlnp | grep ${PORT}"
    exit 1
  fi
  echo "聊天室未在运行。"
fi
