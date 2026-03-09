import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => process.env["EMERGENT_DESKTOP_WS_URL"] ?? null,
  pickFolder: () => ipcRenderer.invoke("desktop:pick-folder"),
});
