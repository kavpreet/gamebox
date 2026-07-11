import { io, type Socket } from 'socket.io-client';

/**
 * One shared socket with reconnect-with-backoff, plus the TV resilience layer
 * from plan §5.7: if reconnection keeps failing for ~45s, do a full page
 * reload — there's no human at the TV to hit refresh.
 */
let socket: Socket | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    // Force WebSocket only. The polling transport is what hits the
    // ERR_HTTP_HEADERS_SENT race in engine.io under concurrent traffic
    // (see incident 8ad1c81) — skipping it removes that whole bug class.
    // Trade-off: no polling fallback, so this assumes WS reliably
    // reaches the origin through Traefik/Cloudflare for every client's
    // network (confirmed working: Cloudflare WebSockets is enabled).
    // If any deployment profile can't guarantee WS end-to-end (e.g. a
    // restrictive corporate/mobile network), this trade needs revisiting.
    transports: ['websocket'],
  });

  socket.on('disconnect', () => {
    if (!reloadTimer) {
      reloadTimer = setTimeout(() => {
        window.location.reload();
      }, 45_000);
    }
  });
  socket.on('connect', () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  });

  return socket;
}

export function emitAck<T = { ok: boolean; error?: string }>(
  event: string,
  payload: unknown,
): Promise<T> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (response: T) => resolve(response));
  });
}
