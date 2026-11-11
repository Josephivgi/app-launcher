"use strict";

// Flags entries that look harmful. Nothing is blocked: the card shows the
// warning, and a click in the window asks once before running a flagged entry.
// Each rule is [pattern, plain reason]. Patterns run on the lowercased text.

const COMMAND_RULES = [
  [/\b(?:rm|rmdir)\s+(?:-[a-z]*[rf][a-z]*\s+)+(?:\/|~|\*|[a-z]:)/, "Deletes files recursively"],
  [/\b(?:del|erase)\b[^\r\n]*\s\/[sq]\b/, "Deletes files in bulk"],
  [/\b(?:rd|rmdir)\b[^\r\n]*\s\/s\b/, "Deletes whole folders"],
  [/\bremove-item\b[^\r\n]*-recurse/, "Deletes whole folders"],
  [/\bformat(?:\.com)?\s+[a-z]:/, "Formats a drive"],
  [/\b(?:diskpart|clear-disk|initialize-disk|format-volume|cipher\s+\/w)\b/, "Wipes or repartitions a disk"],
  [/(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\r\n|]*\|\s*(?:sh|bash|iex|powershell|pwsh|cmd)\b/, "Downloads a script and runs it"],
  [/\b(?:iex|invoke-expression)\b/, "Runs code it builds or downloads at run time"],
  [/\s-(?:e|ec|enc|encodedcommand)\s+[a-z0-9+/=]{16,}/, "Runs a hidden (encoded) PowerShell command"],
  [/\b(?:certutil)\b[^\r\n]*-(?:urlcache|decode)/, "Downloads or decodes a file with certutil"],
  [/\bbitsadmin\b[^\r\n]*\/transfer/, "Downloads a file in the background"],
  [/\breg(?:\.exe)?\s+(?:delete|add)\b/, "Changes the Windows registry"],
  [/\b(?:remove-itemproperty|set-itemproperty|new-itemproperty)\b[^\r\n]*hk(?:lm|cu)/, "Changes the Windows registry"],
  [/\bschtasks(?:\.exe)?\s+\/create\b|\bregister-scheduledtask\b/, "Creates a scheduled task"],
  [/\b(?:set-mppreference|add-mppreference)\b|\bdisablerealtimemonitoring\b/, "Changes Windows Defender settings"],
  [/\bnetsh\s+(?:adv)?firewall\b/, "Changes firewall settings"],
  [/\bvssadmin\b[^\r\n]*delete|\bwbadmin\b[^\r\n]*delete|\bbcdedit\b/, "Deletes backups or changes boot settings"],
  [/\b(?:shutdown|stop-computer|restart-computer)\b/, "Shuts down or restarts the PC"],
  [/\b(?:net\s+user|net\s+localgroup)\b[^\r\n]*\/add/, "Adds a user or changes admin rights"],
  [/\btakeown\b|\bicacls\b[^\r\n]*\/grant/, "Changes file ownership or permissions"],
  [/\.ssh[\\/]|id_rsa|id_ed25519|login data|\\cookies\b|\.aws[\\/]credentials/, "Reads private keys, passwords or browser cookies"],
];

const RISKY_FOLDERS = [
  [/\\appdata\\local\\temp\\|\\windows\\temp\\/, "Runs a program from a temp folder"],
  [/\\downloads\\[^\\]+\.(?:exe|com|bat|cmd|ps1|vbs|js|scr|msi)$/, "Runs a file straight from Downloads"],
];

const SCRIPT_EXTS = /\.(?:bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|scr|pif)$/;

function unique(list) {
  return [...new Set(list)];
}

function commandWarnings(text) {
  const t = String(text || "").toLowerCase();
  return COMMAND_RULES.filter(([re]) => re.test(t)).map(([, why]) => why);
}

function warningsOf(app) {
  if (!app || !app.launch) return [];
  const kind = app.kind || "app";
  if (kind === "command") return unique(commandWarnings(app.launch.command));
  if (kind === "website") {
    const out = [];
    try {
      const url = new URL(app.launch.url);
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) && !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)) out.push("Opens a bare IP address instead of a site name");
      if (url.username || url.password) out.push("The address hides a user name or password in it");
      if (/^xn--|\.xn--/.test(url.hostname)) out.push("The site name uses look-alike characters");
    } catch {}
    return out;
  }
  const exe = String(app.launch.exe || "").toLowerCase();
  const out = RISKY_FOLDERS.filter(([re]) => re.test(exe)).map(([, why]) => why);
  if (SCRIPT_EXTS.test(exe)) out.push("Runs a script file, not a program");
  out.push(...commandWarnings((app.launch.args || []).join(" ")));
  return unique(out);
}

module.exports = { warningsOf, commandWarnings };
