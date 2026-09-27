# MC Server Manager

A free Windows desktop app that lets Minecraft players create and run their own server in a few clicks — no command line, no config-file hunting.

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

To enable CurseForge, create a `.env` file:

```
MAIN_VITE_CURSEFORGE_KEY=your_key
```

## Note

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
