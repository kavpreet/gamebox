#!/usr/bin/env bash
# Polls the backend's /healthz before the kiosk browser launches, so a Pi that
# boots faster than the server never shows a connection-refused page (plan §5.7).
URL="${GAMEBOX_HEALTH_URL:-https://lan.gamebox.example.com/healthz}"
for i in $(seq 1 120); do
  if curl -fsS --max-time 3 "$URL" > /dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done
# launch anyway after 4 minutes — the frontend reload-fallback takes over from there
exit 0
