"use strict";

// Tool list for the App Launcher MCP server. Pure data so the stdio proxy can
// answer tools/list even before the app answers; the handlers live in
// lib/app-tools.js and run inside the app or against the database.

const id = { type: "string", description: "App id (lowercase letters, digits, dashes), e.g. simple-recorder." };

const appFields = {
  kind: {
    type: "string",
    enum: ["app", "website", "command"],
    description: "app (a program to start, the default), website (opens a URL in the browser), or command (runs a shell command line). Passing url without exe means website; command without exe means command.",
  },
  icon: {
    type: "string",
    description:
      "The card's icon: a full path to an image file (png, jpg, gif, webp, svg, ico, bmp), an https:// image URL, or a data: URI. It is copied into App Launcher, so the original can move. A full path to an .exe or .lnk uses that file's icon. Empty string removes it. Apps without one show their exe's icon.",
  },
  command: { type: "string", description: 'Commands only: the command line to run, e.g. "npm run dev" or "code .". Several lines run one after another.' },
  shell: { type: "string", enum: ["cmd", "powershell"], description: "Commands only: which shell runs it. Default cmd." },
  terminal: { type: "boolean", description: "Commands only: true (default) opens a terminal window that stays open so the user sees the output; false runs it with no window (for commands that start a GUI app or a background job)." },
  section: {
    type: "string",
    enum: ["mine", "external"],
    description: 'Which list the card sits in: "mine" (default) for apps the user made, "external" for apps someone else made that the user launches from here (for example T3 Code, Orca or Herdr).',
  },
  name: { type: "string", description: "Display name." },
  url: { type: "string", description: "Websites only: the https:// or http:// address to open." },
  browser: { type: "string", description: "Websites only, optional: full path of the browser exe to open it in. Empty uses the default browser." },
  description: { type: "string", description: "One short line about what the app does." },
  exe: { type: "string", description: "Apps only: full path of the program to launch." },
  args: { description: "Launch arguments: array of strings, or one string split on spaces." },
  cwd: { type: "string", description: "Working folder, a full path. Apps default to the exe folder, commands to the user's home folder." },
  repo: { type: "string", description: "GitHub repo as owner/name, used for the latest-version check. Empty for none." },
  versionSource: {
    type: "object",
    description:
      'Where the installed version comes from. {type:"json", path, key?} reads a JSON file (key defaults to version, dots allowed: a.b); {type:"text", path} reads a file holding just the version; {type:"exe"} reads the exe file version; {type:"manual", value} stores a version by hand.',
  },
};

const TOOLS = [
  {
    name: "launcher_guide",
    description: "Read the App Launcher guide: what an app record holds, how version checks work, and how to find an app's exe, repo, and installed version. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "app_list",
    description: "List everything in the launcher: apps (exe, repo, installed and latest version, check status), websites (url), and commands (command line, folder, shell), each with its icon.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "app_add",
    description:
      "Add a one-click entry to the launcher: an app (name + exe), a website (name + url), or a command (name + command, optional cwd/shell/terminal). Pass icon to give it a picture. It shows up in the App Launcher window at once, and works even if the window is closed. Apps get a GitHub version check. Fails if the id exists (use app_update). Look at the disk first: never guess an exe path, folder, or repo.",
    inputSchema: { type: "object", properties: Object.assign({ id: { type: "string", description: "Optional. Defaults to a slug of name." } }, appFields), required: ["name"], additionalProperties: false },
  },
  {
    name: "app_update",
    description: "Change fields of an existing app (only the fields you pass change), then re-run its version check.",
    inputSchema: { type: "object", properties: Object.assign({ id }, appFields), required: ["id"], additionalProperties: false },
  },
  {
    name: "app_remove",
    description: "Remove an app from the launcher. The program itself is not touched.",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
  },
  {
    name: "app_check",
    description: "Check an app's installed version against its newest GitHub release (or tag). Omit id to check every app.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "app_launch",
    description: "Start an app, open a website, or run a command, the same as the user clicking it. Only use when the user asked to run or open it.",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
  },
];

module.exports = { TOOLS };
