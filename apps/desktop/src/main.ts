import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";

const APP_DISPLAY_NAME = "Overstory";
const _APP_BUNDLE_ID = "com.emergent.overstory";
const _isDevelopment = !!process.env["VITE_DEV_SERVER_URL"];
const _STATE_DIR =
  process.env["EMERGENT_STATE_DIR"] ??
  path.join(app.getPath("home"), ".emergent", "userdata");

let mainWindow: BrowserWindow | null = null;

function configureAppIdentity() {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    version: app.getVersion(),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    title: APP_DISPLAY_NAME,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env["VITE_DEV_SERVER_URL"]) {
    mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "apps", "web", "dist", "index.html"),
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:pick-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

// Auto-updater stub
try {
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  autoUpdater.autoDownload = false;
  // No update server configured yet
} catch {
  // electron-updater not available in dev
}

app.on("ready", () => {
  configureAppIdentity();
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  // Clean shutdown
});

process.on("SIGINT", () => {
  app.quit();
});

process.on("SIGTERM", () => {
  app.quit();
});
