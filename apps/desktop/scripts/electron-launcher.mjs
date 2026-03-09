// macOS app bundle customizer
// Copies Electron.app bundle, patches Info.plist with Overstory branding
import { existsSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = join(__dirname, "..");
const require = createRequire(import.meta.url);

const BUNDLE_ID = "com.emergent.overstory";
const DISPLAY_NAME = "Overstory";

export function resolveElectronPath() {
  // Resolve the electron binary
  const electronPath = require("electron");
  if (typeof electronPath !== "string") {
    throw new Error("Could not resolve electron binary path");
  }

  if (process.platform !== "darwin") {
    return electronPath;
  }

  // On macOS, customize the app bundle for proper dock display
  const cacheDir = join(desktopDir, ".electron-cache");
  const cachedApp = join(cacheDir, `${DISPLAY_NAME}.app`);
  const marker = join(cacheDir, ".patched");

  if (existsSync(marker)) {
    const binary = join(
      cachedApp,
      "Contents",
      "MacOS",
      "Electron",
    );
    if (existsSync(binary)) return binary;
  }

  // Find the Electron.app bundle
  const electronDir = dirname(electronPath);
  const electronApp = join(electronDir, "..", "..", "..");

  if (!existsSync(join(electronApp, "Contents", "Info.plist"))) {
    // Not a macOS app bundle, return raw binary
    return electronPath;
  }

  // Copy and patch
  cpSync(electronApp, cachedApp, { recursive: true });

  const plistPath = join(cachedApp, "Contents", "Info.plist");
  let plist = readFileSync(plistPath, "utf-8");

  plist = plist.replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleDisplayName</key>\n\t<string>${DISPLAY_NAME}</string>`,
  );
  plist = plist.replace(
    /<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleIdentifier</key>\n\t<string>${BUNDLE_ID}</string>`,
  );
  plist = plist.replace(
    /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleName</key>\n\t<string>${DISPLAY_NAME}</string>`,
  );

  writeFileSync(plistPath, plist);
  writeFileSync(marker, new Date().toISOString());

  return join(cachedApp, "Contents", "MacOS", "Electron");
}
