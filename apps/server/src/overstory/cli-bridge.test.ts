import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock child_process before importing the module
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
  coordinatorStatus,
  coordinatorStart,
  coordinatorStop,
  hasOverstoryConfig,
} from "./cli-bridge.js";

const mockExecFile = vi.mocked(execFile);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("coordinatorStatus", () => {
  it("parses JSON output with running: true", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, JSON.stringify({ running: true }), "");
      return {} as any;
    });

    const result = await coordinatorStatus("/workspace");
    expect(result).toEqual({ running: true });
  });

  it("parses JSON output with running: false", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, JSON.stringify({ running: false }), "");
      return {} as any;
    });

    const result = await coordinatorStatus("/workspace");
    expect(result).toEqual({ running: false });
  });

  it("returns ov_not_found error on ENOENT", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      const err = new Error("spawn ov ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "", "");
      return {} as any;
    });

    const result = await coordinatorStatus("/workspace");
    expect(result).toEqual({ running: false, error: "ov_not_found" });
  });

  it("falls back to exit code when output is not JSON", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "coordinator is running", "");
      return {} as any;
    });

    const result = await coordinatorStatus("/workspace");
    expect(result).toEqual({ running: true }); // exitCode 0 → running
  });
});

describe("coordinatorStart", () => {
  it("calls ov with correct args and 60s timeout", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "started", "");
      return {} as any;
    });

    const result = await coordinatorStart("/workspace");
    expect(result).toEqual({ stdout: "started", stderr: "", exitCode: 0 });
    expect(mockExecFile).toHaveBeenCalledWith(
      "ov",
      ["coordinator", "start"],
      expect.objectContaining({ cwd: "/workspace", timeout: 60_000 }),
      expect.any(Function),
    );
  });

  it("rejects on ENOENT", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      const err = new Error("spawn ov ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err, "", "");
      return {} as any;
    });

    await expect(coordinatorStart("/workspace")).rejects.toThrow("not found");
  });
});

describe("coordinatorStop", () => {
  it("calls ov with correct args", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "stopped", "");
      return {} as any;
    });

    const result = await coordinatorStop("/workspace");
    expect(result).toEqual({ stdout: "stopped", stderr: "", exitCode: 0 });
    expect(mockExecFile).toHaveBeenCalledWith(
      "ov",
      ["coordinator", "stop"],
      expect.objectContaining({ cwd: "/workspace" }),
      expect.any(Function),
    );
  });
});

describe("hasOverstoryConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ov-test-"));
  });

  it("returns true when .overstory/config.yaml exists", () => {
    const ovDir = join(tempDir, ".overstory");
    mkdirSync(ovDir, { recursive: true });
    writeFileSync(join(ovDir, "config.yaml"), "workspace: test\n");

    expect(hasOverstoryConfig(tempDir)).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when .overstory/config.yaml does not exist", () => {
    expect(hasOverstoryConfig(tempDir)).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
