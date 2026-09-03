import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray, ipcMain, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "./agent.js";
import { readAutoLaunch, setAutoLaunch } from "./electron-settings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let tray = null;
let agent = null;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("activate", () => showWindow());
}

function createTrayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="7" fill="#d7f46c"/><path d="M10 21V11h4v10h-4Zm8 0V7h4v14h-4Z" fill="#131518"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function showWindow() {
  if (!mainWindow) return;
  app.focus({ steal: true });
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
}

function buildTrayMenu() {
  const isPaused = Boolean(agent?.isPaused());
  return Menu.buildFromTemplate([
    { label: "Open MyBridge", click: showWindow },
    { type: "separator" },
    { label: isPaused ? "Resume Sync" : "Pause Sync", click: async () => {
      await agent?.setPaused(!isPaused);
      tray?.setContextMenu(buildTrayMenu());
    } },
    { type: "separator" },
    { label: "Quit MyBridge", click: () => { isQuitting = true; app.quit(); } }
  ]);
}

async function createWindow() {
  agent = new Agent({ dataDir: app.getPath("userData"), httpPort: 0, enableDiscovery: true });
  await agent.start();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 850,
    minWidth: 760,
    minHeight: 660,
    title: "MyBridge",
    backgroundColor: "#131518",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(currentDirectory, "preload.js")
    }
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`http://127.0.0.1:${agent.port}`);

  tray = new Tray(createTrayImage());
  tray.setToolTip("MyBridge");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", showWindow);

}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.mybridge.app");
  if (process.platform === "darwin") app.dock?.hide();
  try {
    const launchedAtLogin = Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
    if (!app.getLoginItemSettings().openAtLogin) setAutoLaunch(app, true);
    await createWindow();
    if (!launchedAtLogin) showWindow();
  } catch (error) {
    await dialog.showMessageBox({ type: "error", title: "MyBridge 启动失败", message: error.message });
    app.quit();
  }
});

powerMonitor.on("resume", () => { void agent?.handleResume(); });

ipcMain.handle("pick-folder", async (_event, currentPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择同步文件夹",
    defaultPath: currentPath || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("open-path", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !path.isAbsolute(targetPath)) throw new Error("Only local absolute paths can be opened");
  return shell.openPath(path.resolve(targetPath));
});

ipcMain.handle("get-auto-launch", () => readAutoLaunch(app));
ipcMain.handle("set-auto-launch", (_event, enabled) => setAutoLaunch(app, enabled));
ipcMain.handle("get-runtime", () => ({ paused: Boolean(agent?.isPaused()), autoLaunch: readAutoLaunch(app) }));
ipcMain.handle("set-paused", async (_event, paused) => {
  await agent?.setPaused(paused);
  tray?.setContextMenu(buildTrayMenu());
  return Boolean(agent?.isPaused());
});

app.on("before-quit", async (event) => {
  if (!agent) return;
  event.preventDefault();
  const currentAgent = agent;
  agent = null;
  await currentAgent.stop();
  isQuitting = true;
  app.quit();
});

app.on("window-all-closed", (event) => event.preventDefault());
