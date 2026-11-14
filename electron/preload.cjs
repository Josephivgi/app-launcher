"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("shell", {
  appInfo: invoke("app-info"),
  setTheme: invoke("set-theme"),
  openExternal: invoke("open-external"),
  confirmDiscard: invoke("confirm-discard"),
  apps: {
    list: invoke("apps-list"),
    add: invoke("apps-add"),
    update: invoke("apps-update"),
    remove: invoke("apps-remove"),
    check: invoke("apps-check"),
    launch: invoke("apps-launch"),
    installUpdate: invoke("apps-install-update"),
    pickExe: invoke("apps-pick-exe"),
    pickIcon: invoke("apps-pick-icon"),
    pickFolder: invoke("apps-pick-folder"),
  },
  selfUpdate: {
    state: invoke("self-update-state"),
    check: invoke("self-update-check"),
    install: invoke("self-update-install"),
  },
  agents: {
    list: invoke("agents-list"),
    connect: invoke("agents-connect"),
    disconnect: invoke("agents-disconnect"),
  },
  onEvent(handler) {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on("app-event", listener);
    return () => ipcRenderer.removeListener("app-event", listener);
  },
});
