# Raspberry Pi TV kiosk setup

Target: Raspberry Pi OS (64-bit, **Desktop** image — Bookworm, Wayland/labwc).

1. Flash Raspberry Pi OS Desktop, boot, connect to your network.
2. `raspi-config` → Display Options → **disable screen blanking**;
   Boot Options → **wait for network at boot**.
3. Copy `wait-for-backend.sh` to `/home/pi/wait-for-backend.sh`, `chmod +x` it.
4. Copy `gamebox-kiosk.service` to `~/.config/systemd/user/`, edit the two
   URLs (health check + TV page) and the room code (e.g. `LIVING_ROOM` — this
   names the TV; each physical TV gets its own code).
5. Enable it:

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now gamebox-kiosk
   loginctl enable-linger pi
   ```

The TV boots to an idle "cast a game here" screen. From a phone, open a game
lobby and tap **Cast here** next to the TV's name — no SSH needed on game night.

If this Pi is *also* the LAN server, install Podman and follow
`infra/quadlets/` — the browser runs natively, the server runs in containers;
the two don't interact beyond the URL.
