import { execSync } from "node:child_process";
import { mkdirSync, cpSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Platform = "mac" | "linux" | "win";
type Target = "dmg" | "AppImage" | "nsis";
type Arch = "arm64" | "x64" | "universal";

function parseArgs() {
  const args = process.argv.slice(2);
  let platform: Platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
  let target: Target = platform === "mac" ? "dmg" : platform === "linux" ? "AppImage" : "nsis";
  let arch: Arch = process.arch === "arm64" ? "arm64" : "x64";
  let buildVersion = "";
  let outputDir = join(process.cwd(), "release");
  let skipBuild = false;
  let signed = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--platform":
        platform = args[++i] as Platform;
        break;
      case "--target":
        target = args[++i] as Target;
        break;
      case "--arch":
        arch = args[++i] as Arch;
        break;
      case "--build-version":
        buildVersion = args[++i]!;
        break;
      case "--output-dir":
        outputDir = args[++i]!;
        break;
      case "--skip-build":
        skipBuild = true;
        break;
      case "--signed":
        signed = true;
        break;
      case "--verbose":
        verbose = true;
        break;
    }
  }

  return { platform, target, arch, buildVersion, outputDir, skipBuild, signed, verbose };
}

function getElectronBuilderPlatformFlag(platform: Platform): string {
  switch (platform) {
    case "mac": return "--mac";
    case "linux": return "--linux";
    case "win": return "--win";
  }
}

function getElectronBuilderTargetFlag(target: Target): string {
  switch (target) {
    case "dmg": return "dmg";
    case "AppImage": return "AppImage";
    case "nsis": return "nsis";
  }
}

async function main() {
  const opts = parseArgs();
  const rootDir = join(import.meta.dirname ?? process.cwd(), "..");
  const desktopDir = join(rootDir, "apps", "desktop");
  const serverDir = join(rootDir, "apps", "server");

  if (!opts.skipBuild) {
    console.log("Building workspaces...");
    execSync("bun run build:desktop", { cwd: rootDir, stdio: "inherit" });
  }

  // Stage release directory
  const stageDir = join(tmpdir(), `emergent-release-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  console.log(`Staging release in ${stageDir}...`);

  // Copy dist-electron
  cpSync(join(desktopDir, "dist-electron"), join(stageDir, "dist-electron"), {
    recursive: true,
  });

  // Copy server dist if it exists
  const serverDist = join(serverDir, "dist");
  if (existsSync(serverDist)) {
    cpSync(serverDist, join(stageDir, "server-dist"), { recursive: true });
  }

  // Write stage package.json with electron-builder config
  const stagePackageJson = {
    name: "overstory",
    version: opts.buildVersion || "0.0.1",
    main: "dist-electron/main.js",
    build: {
      appId: "com.emergent.overstory",
      productName: "Overstory",
      directories: {
        output: "output",
      },
      files: ["dist-electron/**/*", "server-dist/**/*"],
      mac: {
        category: "public.app-category.developer-tools",
        target: opts.target,
        ...(opts.signed && process.env["CSC_LINK"]
          ? {
              identity: process.env["CSC_IDENTITY"] ?? null,
              hardenedRuntime: true,
              entitlements: "entitlements.mac.plist",
              entitlementsInherit: "entitlements.mac.plist",
            }
          : { identity: null }),
      },
      linux: {
        category: "Development",
        target: opts.target,
      },
      win: {
        target: opts.target,
      },
    },
  };

  writeFileSync(
    join(stageDir, "package.json"),
    JSON.stringify(stagePackageJson, null, 2),
  );

  // Run electron-builder
  const platformFlag = getElectronBuilderPlatformFlag(opts.platform);
  const targetFlag = getElectronBuilderTargetFlag(opts.target);
  const archFlag = opts.arch === "universal" ? "--universal" : `--${opts.arch}`;

  const builderArgs = [
    "electron-builder",
    platformFlag,
    targetFlag,
    archFlag,
    "--project",
    stageDir,
  ];

  if (opts.verbose) {
    console.log(`Running: bunx ${builderArgs.join(" ")}`);
  }

  console.log("Running electron-builder...");
  execSync(`bunx ${builderArgs.join(" ")}`, {
    cwd: stageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(opts.signed && process.env["APPLE_API_KEY_ID"]
        ? {
            APPLE_API_KEY_ID: process.env["APPLE_API_KEY_ID"],
            APPLE_API_ISSUER: process.env["APPLE_API_ISSUER"],
          }
        : {}),
    },
  });

  // Copy artifacts to output dir
  mkdirSync(opts.outputDir, { recursive: true });
  const outputSrc = join(stageDir, "output");
  if (existsSync(outputSrc)) {
    cpSync(outputSrc, opts.outputDir, { recursive: true });
  }

  console.log(`Artifacts written to ${opts.outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
