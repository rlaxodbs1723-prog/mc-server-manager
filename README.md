# MC CubePanel (formerly MC Server Manager)

A free Windows desktop app that lets Minecraft players create and run their own server in a few clicks — no command line, no config-file hunting.

**Download: https://cubepanel.kr** (마인크래프트 서버 1분 만에 만들기, 한국어 지원)

## Features

- **Create a server** — Vanilla, Paper, Fabric, Forge, NeoForge. Java is downloaded automatically.
- **Mods & modpacks** — search Modrinth and CurseForge, install with dependencies, update installed mods.
- **Server compatibility check** — detects client-only mods (and mods that crash on dedicated servers) and asks before turning them off.
- **Crash analysis** — explains why the server crashed in plain language.
- **Backups** — automatic and manual backups, one-click restore (the current world is backed up first).
- **Worlds & maps** — import worlds, browse maps.
- **Players** — whitelist, operators, bans, invite info.
- **Config editor** — browse and edit server/mod config files inside the app.
- **Automation** — daily restart, stop when empty, start with the app, welcome message.

## How the CurseForge API is used

- Searching and browsing mods, modpacks and maps.
- Downloading files **only when the author allows third-party distribution**.
  Mods that disallow it are never downloaded automatically — the app shows a link to the CurseForge page so players download them from CurseForge directly.
- Checking installed mods for updates.

## Build

Requires Node.js 20+.

```bash
npm install
npm run dev      # run in development
npm run dist     # build the Windows installer
```

CurseForge requests, bug reports and the in-app inbox go through small relay functions on the website (`relay/`, served by Cloudflare Pages `functions/` and the older Netlify `netlify/functions`).
The CurseForge API key, the Discord webhook and the Discord bot token live only in the hosting environment variables (`CURSEFORGE_KEY`, `BUG_WEBHOOK`, `DISCORD_BOT_TOKEN`), never in the app.

## Note

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
