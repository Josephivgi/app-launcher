# App Launcher guide for agents

App Launcher is the user's one-click launcher. Each card has an icon and opens with one click: an app, a website, or a shell command. It also checks whether each app has a newer version on GitHub. You add entries for the user.

The `app_*` tools work whether or not the App Launcher window is open. When it is closed they write to its database and the window shows the change next time it opens.

## An app record

| Field | Meaning |
|---|---|
| `id` | lowercase letters, digits, dashes. Defaults to a slug of `name`. |
| `name`, `description` | shown on the app's card |
| `exe` | full path of the program to launch (required) |
| `args`, `cwd` | optional launch arguments and working folder |
| `repo` | GitHub `owner/name` for the version check, or empty |
| `versionSource` | where the installed version is read from (below) |

## Icons

Pass `icon` with `app_add` or `app_update`:

- a full path to an image: `.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp` (up to 5 MB)
- an `https://` URL of an image
- a `data:image/...;base64,...` URI
- a full path to an `.exe` or `.lnk`, to use that file's icon

The image is copied into App Launcher, so the original can move or be deleted. `icon: ""` removes it. An app with no icon shows its exe's icon; websites and commands without one show a plain symbol.

Good sources: the app's own icon file (look for `icon.png`, `*.ico`, `build/icon.*`, `resources/*.png` in its folder), a project's logo in its repo, or a site's `https://<host>/favicon.ico` or `apple-touch-icon.png`. Check the file exists or the URL loads before passing it.

## Commands

A command entry has `kind: "command"` (or just pass `command` without `exe`), `name`, `command`, and optionally `cwd`, `shell`, `terminal`, `description`, `icon`.

| Field | Meaning |
|---|---|
| `command` | the command line, e.g. `npm run dev`, `code .`, `python manage.py runserver`. Several lines run in order. |
| `cwd` | full path of the folder it runs in. Default: the user's home folder. |
| `shell` | `cmd` (default) or `powershell` |
| `terminal` | `true` (default): a terminal window opens and stays open so the user sees output. `false`: runs with no window, for commands that only start a GUI app or a background job. |

Example: `{"name":"Blog dev server","command":"npm run dev","cwd":"C:\\Users\\me\\blog","icon":"C:\\Users\\me\\blog\\public\\logo.png"}`

Use a command when the thing to open is a command line. Use an app when it is a single program file.

## Installing updates

App Launcher can download a newer release from the app's GitHub repo and open its Windows installer, but only when the person clicks **Update to** on the card and confirms. The `app_list` entry shows `installer` (the file name) when a release has one. You cannot install updates yourself.

## Websites

A website entry has `kind: "website"`, `name`, `url`, and optionally `description` and `browser`. Passing `url` without `exe` makes a website. `url` must be `https://` or `http://` (a bare host like `example.com` gets `https://`). `browser` is the full path of a browser exe, for example `C:\Program Files\Google\Chrome\Application\chrome.exe`; leave it empty for the user's default browser. Websites have no version check. `app_launch` opens them.

## Version checks

`app_check` reads the installed version, asks GitHub for the repo's newest release (falling back to the newest version tag), and compares. Status is one of `current`, `update`, `ahead`, `unknown`, `error`, `no-repo`. Only public repos are readable. Unauthenticated GitHub allows about 60 requests an hour, so do not loop checks.

`versionSource` types:

- `{type:"json", path, key}` a JSON file with a version field. `key` defaults to `version`; dots reach nested keys.
- `{type:"text", path}` a file that holds only the version.
- `{type:"exe"}` the exe's ProductVersion (works for many installers' apps, not all).
- `{type:"manual", value}` a version typed by hand. Last resort: it will not follow updates.

## Adding an app well

1. Find the exe. Look at the user's Start Menu shortcuts, `%LOCALAPPDATA%\Programs`, `C:\Program Files`, or the folder the user names. Confirm the file exists.
2. Find the repo. Check the app's `package.json` (`repository`), `install.json` or other manifest, a `.git/config` remote, `LICENSE`/`README`, or an About screen. If the app has a private dev repo and a public release repo, use the public one: only it is readable.
3. Find the installed version. Prefer a JSON file the app writes (`install.json`, `package.json` inside `resources\app`, `version`). Fall back to `exe`.
4. Call `app_add`, then read the result: `status` must not be `error`, and `installed` should be non-empty. If `installed` is empty, fix `versionSource` with `app_update`.
5. Tell the user what you added and the status the check returned.

Do not modify the other app's files. Do not guess a path or repo you did not see.
