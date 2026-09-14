import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { MotoEndpoint, setupMoto } from "./moto";

const IntegrationTimeout = 60_000;
const execute = promisify(execFile);

before(async function () {
  this.timeout(IntegrationTimeout);
  await setupMoto();
});

describe("S3 HTTP fault and conditional-write coverage", () => {
  it("passes the isolated provider-specific HTTP suite", async function () {
    this.timeout(IntegrationTimeout);
    const result = await execute(
      process.execPath,
      ["--test", "scripts/test-uploads.mjs"],
      {
        env: { ...process.env, S3_UPLOAD_TEST_ENDPOINT: MotoEndpoint },
        timeout: IntegrationTimeout,
      },
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  });
});
