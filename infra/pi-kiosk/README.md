# Raspberry Pi TV kiosk setup

Target: Raspberry Pi OS (64-bit, **Desktop** image — Bookworm, Wayland/labwc).

0. **Create the room first.** Rooms no longer self-register: sign in as an admin,
   open `/admin` → *Add a room*, and give it a code (e.g. `LIVING_ROOM`) and a
   PIN. A TV that opens an unknown code just sits at the pairing prompt.
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

## Pairing the TV

The first boot lands on a PIN prompt. Either type the room's PIN on the remote
once (the token is stored in the browser profile and survives reboots), or skip
typing entirely: in `/admin` hit **Kiosk link** for that room and paste the
resulting `…/tv?room=CODE&token=…` URL into the service file instead. The page
strips the token from the address bar after storing it.

Treat a kiosk link like a password. **Sign out TVs** in `/admin` invalidates
every token for that room; changing the PIN does the same.

Once paired, the TV shows the idle "cast a game here" screen. From a phone, open
a game lobby and tap **Cast here** next to the TV's name — no SSH needed on game
night.

If this Pi is *also* the LAN server, install Podman and follow
`infra/quadlets/` — the browser runs natively, the server runs in containers;
the two don't interact beyond the URL.
