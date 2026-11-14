# Changelog

## 0.4.0

**New**

- Search works from the keyboard. Press Ctrl+K or / to jump to search, Enter to open the first match, and Esc to clear it. While you search, the count shows how many match, like "1 of 6".
- Cards show their description under the name, so apps an agent adds say what they do.
- Apps have a Start in folder field and an Arguments box with one argument per line.

**Improved**

- Edit, Remove and Check are always visible on each card, not only when you hover over it.
- The add form is shorter. The type comes from the button you clicked, Name sits next to Show under, and the examples in empty fields start with "e.g.".
- The button next to Add is now labeled Check for updates, and the top bar says "App Launcher v..." so it is clear which update it means.
- Esc closes an open form. If you typed something, it asks before throwing it away.
- When an update check fails, hovering the card shows why.
- Addresses like localhost:4310 open over http, which is what local dev servers use.
- Agents get a fuller guide: every field, which kinds it applies to, and an example. app_list now includes each app's start folder.

**Fixed**

- Adding an app by hand failed with "A json version source needs a full path" unless you filled in the version fields. It now reads the version from the program itself.
- Commands set to run without a terminal window never ran. They work now.
- Reading an app's version from its .exe always came back empty. It works now.
- Short messages like "Launched Simple Recorder" or "Prompt copied" never appeared. They show at the bottom of the window now.
- The app form showed a "Show a terminal window" checkbox that only applies to commands.
- Pre-release versions like beta.10 and beta.2 were compared in the wrong order.

## 0.3.2

**New**

- Settings tab. App Launcher now has a Settings tab next to Apps and Agents.
- Find other apps. Settings > Find other apps has an **Open jsystems.app** button that opens jsystems.app in your browser, where you can find more JSystems apps.

## 0.3.1

**Improved**

- Apps, websites and commands an agent adds never need approval. App Launcher only warns you when one looks harmful, for example a command that deletes whole folders, downloads a script and runs it, or turns off Windows Defender. The card shows the warning, and clicking it asks once before running.
- Agents see the same warnings in `app_list`, `app_add` and `app_launch`.

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
