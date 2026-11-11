# Changelog

## 0.2.0

**New**

- Update from GitHub. When an app has a newer GitHub release with a Windows installer, its card shows **Update to** the new version. App Launcher downloads the installer from that release, checks it against GitHub's SHA-256 checksum, and opens it. You confirm first.
- You approve what agents add. A program or command an agent adds does not run until you click Run or Launch on it once. App Launcher then shows exactly what will run and asks.
- The update dialog names the GitHub repo the installer comes from.
- Windows installer for App Launcher (`App-Launcher-Setup-0.2.0.exe`), with a Start Menu shortcut.

**Improved**

- Agents can see whether an app is approved and which installer a release has (`app_list`).
- An agent that changes what an app runs, or the GitHub repo it updates from, has to get that change approved again.
- Apps you added before this version ask for approval the first time you run them.

**Fixed**

- Updated the Electron runtime to 44.11.0, which fixes a known security issue.

Windows may show a warning that the app is from an unknown publisher. This build is not code-signed yet.
