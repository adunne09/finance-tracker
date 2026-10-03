import { spawnSync } from "node:child_process";

const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });

if (git.status === 0) {
  const result = spawnSync("lefthook", ["install"], { cwd: git.stdout.trim(), stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} else {
  console.log("No Git repository yet; run pnpm prepare after git init to install hooks.");
}
