# Security

## What App Launcher does with your computer

- It starts programs and shell commands you added. Agents connected through MCP can add entries too, so the app asks you before a program or command an agent added runs for the first time. The approval is stored per app and is dropped when what runs changes.
- It downloads an app's newer installer only from that app's GitHub release downloads, checks the file against GitHub's SHA-256 checksum, and only after you confirm.
- Its own window loads only its bundled files. Websites open only over `https://` or `http://`.
- Agents talk to the running app over a loopback HTTP bridge on `127.0.0.1` that needs a random bearer token written to your data folder. The stdio MCP server opens the database file directly when the app is closed.
- Data stays on your computer: the SQLite database and the icon and download folders under `%APPDATA%\App Launcher`. The app sends no telemetry.

## Known limits

- Builds are not code-signed yet, so Windows may warn about the publisher.
- Once you approve an agent-added program or command, it can run again without another prompt, and an agent can launch it. Remove entries you do not want.
- Checksums come from GitHub. They protect against a corrupted or swapped download, not against a compromised release.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability").
