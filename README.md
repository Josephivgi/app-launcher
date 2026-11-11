# App Launcher

One-click launcher for your apps, websites and shell commands. Each entry is a card with an icon: click it to open. Apps also get a GitHub check for newer releases.

- **App**: a program on this PC. Its icon comes from the exe unless you set one.
- **Website**: opens in your default browser, or a browser you pick.
- **Command**: a command line like `npm run dev`, run in a folder you pick, with Command Prompt or PowerShell. It opens a terminal window that stays open, or runs with no window.

Any entry can have an icon: an image file, an `https://` image URL, or a data URI. The image is copied into App Launcher.

## Install

Download `App-Launcher-Setup-<version>.exe` from the Releases page and run it. The install is for your user account only and needs no administrator rights. Windows may warn that the app is from an unknown publisher, because this build is not code-signed yet.

## Updates

When an app has a newer GitHub release with a Windows installer, its card shows **Update to** the new version. App Launcher downloads the installer from that release, checks it against the SHA-256 checksum GitHub publishes, and asks you before it opens the installer. The dialog names the GitHub repo the file comes from. Apps with no installer on their release link to the release page instead.

## Updating App Launcher itself

The top bar shows App Launcher's version and whether a newer release is out on GitHub. It checks when it starts and every hour, and **Check now** checks right away. When a new version is out, **Update now** downloads the setup from the release, checks it against GitHub's SHA-256 checksum, installs it and restarts App Launcher. A copy installed from git with the beta installer is updated by running the beta installer again.

## Connect your agents

Open the **Agents** tab. App Launcher finds the agents installed on this computer (Claude Code, Cursor, Gemini CLI, Codex) and connects each one by adding its MCP server to that agent's own settings file. The first time it runs, every agent it finds is connected. Each time App Launcher starts, and when its window comes back into focus, connected agents are checked and their entry is rewritten if it went missing or points at an old location. Disconnect removes the entry. The first change to a settings file keeps a copy next to it as `<file>.app-launcher-backup`.

Once connected, an agent can use these tools to add, check and launch apps. The `app_*` tools work even when the App Launcher window is closed.

Tools: `launcher_guide`, `app_list`, `app_add`, `app_update`, `app_remove`, `app_check`, `app_launch`.

Other MCP-capable agents: the Agents page shows the command to add a stdio server named `app-launcher`.

## For developers

```
npm install
npm start          # run the app
npm test           # unit tests
npm run smoke      # hidden end-to-end run (see AGENTS.md for the environment variables)
npm run dist       # build dist/App-Launcher-Setup-<version>.exe
```

Releases: add a `## <version>` section to `CHANGELOG.md`, set the same version in `package.json`, commit, and push a tag such as `v0.2.0`. The release workflow (`.github/workflows/release.yml`) runs the tests, builds the installer, and publishes it with the changelog section as the notes.

Security reports: see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
