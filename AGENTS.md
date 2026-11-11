# Agent instructions (workspace)

Electron desktop app: a one-click launcher for apps, websites and shell commands, each with an icon, plus GitHub version checks for apps. Agents add apps through the App Launcher MCP server. App Launcher connects it to the agents on this computer by writing its entry into their own MCP settings (Claude Code, Cursor, Gemini CLI, Codex). There is no ACP and no chat UI.

## Layout

- `electron/main.cjs` window, `app://` protocol, IPC, SQLite, bridge, agent connections, smoke mode.
- `electron/bridge.cjs` loopback HTTP the stdio server uses to reach the running app. `electron/preload.cjs` the `window.shell` API. `electron/smoke.cjs` the smoke run.
- `lib/agent-connect.js` connects, disconnects and syncs agent MCP settings (JSON for Claude Code, Cursor, Gemini CLI; TOML for Codex). Entries point at `lib/mcp-stdio.cjs` run by Electron with `ELECTRON_RUN_AS_NODE=1`.
- `lib/mcp-tools.js` tool list, `lib/app-tools.js` app_* handlers shared by the app and the stdio server, `lib/mcp-stdio.cjs` the stdio MCP server (with the app closed it runs app_* against the SQLite file itself).
- `lib/apps.js` records (`kind`: app, website, command), validation, launch, seeding. `lib/icons.js` imports icons into `<data>/icons`. `lib/versions.js` installed-version readers and the GitHub check. `lib/releases.js` picks a release's Windows installer, downloads it from GitHub only, checks its SHA-256, and hands it to Windows ("Update to X" on a card; never exposed to agents). `lib/db.js` SQLite (`app-launcher.db`, settings and apps). `lib/paths.js` atomic writes.
- `docs/agent-guide.md` what agents read first (`launcher_guide`).
- `renderer/` shell UI: a top bar with Apps and Agents tabs. Apps (`js/apps.js`), Agents (`js/agents.js`), shell (`js/app.js`).

Data root: `%APPDATA%\App Launcher` (override `APP_LAUNCHER_DATA_ROOT`). Simple Recorder is seeded once on first run.

## Commands

- `npm start` run. Clear `ELECTRON_RUN_AS_NODE` first if the shell sets it.
- `npm test` unit tests.
- `npm run dist` builds `dist/App-Launcher-Setup-<version>.exe` (electron-builder, unsigned). Do not run the installer on the desktop: test it in a VM.
- Releases: bump `package.json` and add a `## <version>` section to `CHANGELOG.md`, then push a `v<version>` tag. `.github/workflows/release.yml` builds and publishes it. Show Joe the changelog text before any public release.
- Running copies of App Launcher and agent MCP servers lock files in `node_modules`. Do not kill them to install; copy the folder elsewhere and install there, or ask.
- `npm run smoke` (set `APP_LAUNCHER_SMOKE=1`, a temp `APP_LAUNCHER_DATA_ROOT`, and a temp `APP_LAUNCHER_HOME`): seeded app, live GitHub check, stdio MCP add, hidden command launch with icon, agent connections written to a scratch home (Claude Code and Codex), icon grid and Agents page render, one-click run. Set `APP_LAUNCHER_SMOKE_NO_BROWSER=1` to skip opening real browser tabs. Never launch console exes for real in tests: a window pops up on the desktop. `APP_LAUNCHER_SHOT=<png>` saves a screenshot.
- Tests must never write the real agent settings. `APP_LAUNCHER_HOME` redirects them; the app skips the startup sync when it is set or in smoke mode.
