import { SvelteSet } from "svelte/reactivity";
import type { FileStatus, CommitInfo } from "../lib/tauri";

class VcsStore {
  changedFiles: FileStatus[] = $state([]);
  stagedPaths: SvelteSet<string> = new SvelteSet();
  selectedFile: string | null = $state(null);
  commits: CommitInfo[] = $state([]);
  commitMessage: string = $state("");

  get stagedCount(): number {
    return this.stagedPaths.size;
  }

  get hasChanges(): boolean {
    return this.changedFiles.length > 0;
  }

  setChangedFiles(files: FileStatus[]) {
    this.changedFiles = files;
  }

  setStagedPaths(paths: Set<string>) {
    this.stagedPaths.clear();
    for (const p of paths) {
      this.stagedPaths.add(p);
    }
  }

  setSelectedFile(path: string | null) {
    this.selectedFile = path;
  }

  setCommits(commits: CommitInfo[]) {
    this.commits = commits;
  }

  setCommitMessage(message: string) {
    this.commitMessage = message;
  }

  reset() {
    this.changedFiles = [];
    this.stagedPaths.clear();
    this.selectedFile = null;
    this.commits = [];
    this.commitMessage = "";
  }
}

export const vcsStore = new VcsStore();
