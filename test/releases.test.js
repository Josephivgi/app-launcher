"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pickInstaller, assertGithubUrl, assertReleaseUrl, safeName } = require("../lib/releases");

const SHA = "a".repeat(64);

test("assertReleaseUrl accepts only the same repo's release downloads", () => {
  const ok = "https://github.com/Owner/Repo/releases/download/v1.0.0/Setup.exe";
  assert.equal(assertReleaseUrl(ok, "owner/repo").hostname, "github.com");
  assert.throws(() => assertReleaseUrl("https://github.com/other/repo/releases/download/v1/Setup.exe", "owner/repo"), /not from the GitHub releases/);
  assert.throws(() => assertReleaseUrl("https://evil.example/owner/repo/releases/download/v1/Setup.exe", "owner/repo"), /Refusing/);
});

test("pickInstaller prefers a setup .exe and skips blockmaps, portable builds and archives", () => {
  const assets = [
    { name: "latest.json", browser_download_url: "https://github.com/o/r/releases/download/v2/latest.json", size: 10 },
    { name: "app-2.0.0.tar.gz", browser_download_url: "https://github.com/o/r/releases/download/v2/app-2.0.0.tar.gz", size: 20 },
    { name: "App-2.0.0-portable.exe", browser_download_url: "https://github.com/o/r/releases/download/v2/App-2.0.0-portable.exe", size: 30 },
    { name: "App-Setup-2.0.0.exe.blockmap", browser_download_url: "https://github.com/o/r/releases/download/v2/x.blockmap", size: 40 },
    { name: "App-Setup-2.0.0.exe", browser_download_url: "https://github.com/o/r/releases/download/v2/App-Setup-2.0.0.exe", size: 50, digest: "sha256:" + SHA },
  ];
  assert.deepEqual(pickInstaller(assets), {
    name: "App-Setup-2.0.0.exe",
    url: "https://github.com/o/r/releases/download/v2/App-Setup-2.0.0.exe",
    size: 50,
    sha256: SHA,
  });
});

test("pickInstaller takes an msi when there is no exe, and returns null with no installer", () => {
  const msi = pickInstaller([{ name: "tool.msi", browser_download_url: "https://github.com/o/r/x/tool.msi", size: 5 }]);
  assert.equal(msi.name, "tool.msi");
  assert.equal(msi.sha256, "");
  assert.equal(pickInstaller([{ name: "source.zip", browser_download_url: "https://github.com/o/r/x" }]), null);
  assert.equal(pickInstaller(undefined), null);
});

test("assertGithubUrl allows only https GitHub hosts", () => {
  assert.equal(assertGithubUrl("https://github.com/o/r/releases/download/v1/a.exe").hostname, "github.com");
  assert.equal(assertGithubUrl("https://objects.githubusercontent.com/x/a.exe").hostname, "objects.githubusercontent.com");
  assert.throws(() => assertGithubUrl("http://github.com/o/r/a.exe"), /Refusing/);
  assert.throws(() => assertGithubUrl("https://example.com/a.exe"), /Refusing/);
  assert.throws(() => assertGithubUrl("https://github.com.evil.example/a.exe"), /Refusing/);
  assert.throws(() => assertGithubUrl("file:///C:/Windows/System32/calc.exe"), /Refusing|not a valid/);
});

test("safeName keeps plain characters only", () => {
  assert.equal(safeName("..\\..\\evil.exe"), "_.._evil.exe");
  assert.ok(!/[\\/]/.test(safeName("a/b\\c.exe")));
  assert.equal(safeName(""), "installer");
});
