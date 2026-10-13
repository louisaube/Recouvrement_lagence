#!/usr/bin/env bash
# Starts the API in the background: NODE_ENV=<development|test> bash scripts/server/start.sh (from api/).
# Stops whatever listens on port 4000, builds, starts, waits until GET /server/health-check answers 200
# (60 s at most). Log: api/.server-<env>.log. Exit 0 when healthy, non-zero otherwise.
set -u
API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$API_DIR" || exit 1
ENVIRONMENT="${NODE_ENV:-development}"
PORT_NUMBER=4000
LOG="$API_DIR/.server-$ENVIRONMENT.log"
export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}" no_proxy="localhost,127.0.0.1${no_proxy:+,$no_proxy}"

listening_pids() {
  if command -v lsof >/dev/null 2>&1; then lsof -t -iTCP:"$PORT_NUMBER" -sTCP:LISTEN 2>/dev/null; return; fi
  if command -v fuser >/dev/null 2>&1; then fuser "$PORT_NUMBER"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'; return; fi
  ss -ltnp "sport = :$PORT_NUMBER" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
}

pids="$(listening_pids)"
if [ -n "$pids" ]; then
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  for _ in $(seq 1 20); do [ -z "$(listening_pids)" ] && break; sleep 0.5; done
  # shellcheck disable=SC2046
  [ -n "$(listening_pids)" ] && kill -9 $(listening_pids) 2>/dev/null
  sleep 0.5
fi

if ! pnpm -s build >"$LOG" 2>&1; then
  echo "build failed, see $LOG" >&2
  exit 1
fi

NODE_ENV="$ENVIRONMENT" nohup node dist/main.js >>"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server stopped during startup, see $LOG" >&2
    tail -n 20 "$LOG" >&2
    exit 1
  fi
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT_NUMBER/server/health-check" 2>/dev/null)" = "200" ]; then
    echo "API ready on http://localhost:$PORT_NUMBER ($ENVIRONMENT, pid $SERVER_PID)"
    exit 0
  fi
  sleep 0.5
done
echo "server not healthy after 60 s, see $LOG" >&2
exit 1
