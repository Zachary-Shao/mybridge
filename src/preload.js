import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mybridge", {
  pickFolder: (currentPath) => ipcRenderer.invoke("pick-folder", currentPath),
  openPath: (targetPath) => ipcRenderer.invoke("open-path", targetPath),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", Boolean(enabled)),
  getRuntime: () => ipcRenderer.invoke("get-runtime"),
  setPaused: (paused) => ipcRenderer.invoke("set-paused", Boolean(paused))
});
