import { spawnSync } from "node:child_process";

const ServiceFreeSuites = [
  "dist/test/index.test.js",
  "dist/test/uploads.test.js",
  "dist/test/private-bucket.test.js",
];

/**
 * The shared CI workflow starts the Moto service only on Linux, so Windows runs the suites
 * that mock S3 and skips the ones that need the server.
 */
const files: (string | undefined)[] =
  process.platform === "win32" ? ServiceFreeSuites : [undefined];

for (const file of files) {
  const args = ["exec", "ajs", "module", "test", "."];
  if (file !== undefined) {
    args.push("-f", file);
  }
  const { status } = spawnSync("pnpm", args, { stdio: "inherit", shell: true });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}
