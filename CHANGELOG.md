# Changelog

## 0.3.0

**New**

- App Launcher updates itself. The top bar shows your version and whether a newer one is out on GitHub. It checks when it opens and every hour, and **Check now** checks right away. **Update now** downloads the new setup, checks it against GitHub's SHA-256 checksum, installs it and restarts App Launcher.

**Improved**

- No more approval prompts. Programs and commands an agent adds run the first time you click them, and agents can launch them too.
- Update checks keep working when GitHub's hourly limit for your connection runs out: App Launcher uses your GitHub CLI login instead, if `gh` is installed and signed in.

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
