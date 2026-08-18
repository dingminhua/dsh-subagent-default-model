#!/usr/bin/env bash
# dev-web.sh — 开发闭环：监听 plugin/ 变更，自动同步到 web profile 的安装副本并
# 重启 DSH web。改完代码不用再手动 cp + 重启。
#
# 用法：
#   bash dev-web.sh                # 前台运行，Ctrl-C 干净退出（停掉 DSH web）
#   bash dev-web.sh --port 8080    # 传额外 dsh web 参数（比如换端口）
#
# 行为：
#   1. 停掉占用 3080 的旧 DSH web（无论是本脚本上次启动的，还是手动启动的）
#   2. 后台启动 DSH web，日志写到 ~/.dsh/dev-web.log
#   3. 每 2s 轮询 plugin/lib 与 package.json 的 mtime
#   4. 变更 → 同步到 node_modules 副本 → 重启 web
#   5. Ctrl-C → 停掉 web，释放端口，不留孤儿进程
#
# 注意：仅做文件同步 + 整进程重启。host 半边（lib/index.js 包 ctx.subagents
# 包装）和 client 半边（lib/client.js 设置行）都必须整重启才生效，本项目未
# 启用 DSH 的 HMR，故不依赖热替换。

set -euo pipefail

PORT=3080
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/plugin"
DST="$HOME/.dsh/profiles/web/node_modules/dsh-subagent-default-model"
BIN="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js"
LOG="$HOME/.dsh/dev-web.log"
PIDFILE="$HOME/.dsh/dev-web.pid"

# 占用端口的 pid 列表（可能多行）
port_pids() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

# 判断 pid 是否像 DSH web：命令行含 "dsh"。
# 读不到命令行（被沙箱/权限过滤）时视为可杀——端口 3080 约定为 DSH web。
is_dsh_web() {
  local p="$1" cmd
  cmd="$(ps -p "$p" -o command= 2>/dev/null || true)"
  [ -z "$cmd" ] && return 0
  echo "$cmd" | grep -qiE "dsh"
}

sync_copy() {
  mkdir -p "$DST/lib"
  cp -R "$SRC/lib/." "$DST/lib/" 2>/dev/null || true
  cp "$SRC/package.json" "$DST/package.json" 2>/dev/null || true
}

# 停掉所有占用端口的 DSH web（先 SIGTERM 温和结束，超时再 SIGKILL）
stop_web() {
  # 1) 按记录的 pid 停（本脚本上次启动的）
  if [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  # 2) 兜底：停掉仍占用端口的 DSH web 进程（含手动启动的）
  local p to_kill=()
  for p in $(port_pids); do
    if is_dsh_web "$p"; then
      to_kill+=("$p")
    else
      echo "跳过端口 $PORT 上的非 DSH 进程 pid $p（命令行不含 dsh），不杀"
    fi
  done
  for p in "${to_kill[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
  # 温和等待端口释放
  wait_port_free 8
  # 还没释放就强制 SIGKILL
  for p in $(port_pids); do
    if is_dsh_web "$p"; then
      echo "强制结束 pid $p (SIGKILL)"
      kill -9 "$p" 2>/dev/null || true
    fi
  done
  wait_port_free 5
}

wait_port_free() {
  local tries="$1" i
  for i in $(seq 1 "$tries"); do
    [ -z "$(port_pids)" ] && return 0
    sleep 1
  done
  return 0
}

start_web() {
  sync_copy
  nohup node "$BIN" web "$@" > "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  # 等端口真正被本进程绑定，或进程已崩溃
  local tries=15 pid
  pid="$(cat "$PIDFILE")"
  for _ in $(seq 1 "$tries"); do
    if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "DSH web 已启动 (pid $pid)，端口 $PORT 监听中，日志: $LOG"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "ERROR: DSH web 启动后退出，最后日志：" >&2
      tail -n 30 "$LOG" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "WARN: 启动后 ${tries}s 仍未在端口 $PORT 监听到，请查日志: $LOG" >&2
}

cleanup() {
  echo
  echo "正在停止 DSH web ..."
  stop_web
  echo "已退出，端口 $PORT 已释放。"
  exit 0
}
trap cleanup INT TERM

# ── 启动 ────────────────────────────────────────────────────────────────
stop_web
start_web || exit 1

echo "监听 $SRC 变更，自动同步 + 重启（Ctrl-C 退出）..."
last="$(stat -f %m "$SRC/lib/index.js" "$SRC/lib/client.js" "$SRC/package.json" 2>/dev/null | tr '\n' ',')"

while true; do
  sleep 2
  cur="$(stat -f %m "$SRC/lib/index.js" "$SRC/lib/client.js" "$SRC/package.json" 2>/dev/null | tr '\n' ',')"
  if [ "$cur" != "$last" ]; then
    last="$cur"
    echo "[$(date +%H:%M:%S)] 检测到变更，重启 DSH web ..."
    stop_web
    start_web || echo "重启失败，继续监听..." >&2
  fi
done
