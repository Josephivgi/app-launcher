# Security

## What App Launcher does with your computer

- It starts programs and shell commands you added. Agents connected through MCP can add and launch entries too, with no prompt, so connect only agents you trust.
- It downloads an app's newer installer only from that app's GitHub release downloads, checks the file against GitHub's SHA-256 checksum, and only after you confirm.
- It updates itself only from its own GitHub releases (`Josephivgi/app-launcher`), after you click Update now, with the same checksum check.
- Its own window loads only its bundled files. Websites open only over `https://` or `http://`.
- Agents talk to the running app over a loopback HTTP bridge on `127.0.0.1` that needs a random bearer token written to your data folder. The stdio MCP server opens the database file directly when the app is closed.
- Data stays on your computer: the SQLite database and the icon and download folders under `%APPDATA%\App Launcher`. The app sends no telemetry.

## Known limits

- Builds are not code-signed yet, so Windows may warn about the publisher.
- A connected agent can add a program or command and run it right away. Disconnect agents on the Agents page, and remove entries you do not want.
- Checksums come from GitHub. They protect against a corrupted or swapped download, not against a compromised release.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability").
