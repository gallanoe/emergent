import { execFile } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

export function execOv(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile("ov", args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("'ov' command not found. Is Overstory installed and on PATH?"));
        return;
      }
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

export async function slingAgent(
  cwd: string,
  taskId: string,
  capability: string,
  runtime?: string,
): Promise<ExecResult> {
  const args = ["sling", "--task", taskId, "--capability", capability];
  if (runtime) {
    args.push("--runtime", runtime);
  }
  return execOv(args, cwd);
}

export async function stopAgent(
  cwd: string,
  agentName: string,
): Promise<ExecResult> {
  return execOv(["stop", agentName], cwd);
}

export async function nudgeAgent(
  cwd: string,
  agentName: string,
  message: string,
): Promise<ExecResult> {
  return execOv(["nudge", agentName, message], cwd);
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export async function sendMail(
  cwd: string,
  to: string,
  subject: string,
  body: string,
  type?: string,
  priority?: string,
): Promise<ExecResult> {
  const args = ["mail", "send", "--to", to, "--subject", subject, "--body", body];
  if (type) {
    args.push("--type", type);
  }
  if (priority) {
    args.push("--priority", priority);
  }
  return execOv(args, cwd);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export async function triggerMerge(
  cwd: string,
  branchName: string,
): Promise<ExecResult> {
  return execOv(["merge", branchName], cwd);
}
