import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";

import {
  MotoEndpoint,
  PrivateBucket,
  PublicBucket,
  PublicUrl,
  TestCredentials,
} from "./moto";

const InterfaceTests = join(
  dirname(require.resolve("@antelopejs/interface-file-storage")),
  "tests/file-storage.test.js",
);
assert.ok(
  existsSync(InterfaceTests),
  "Install the coordinated interface-file-storage release or overlay its packed preview containing dist/tests/file-storage.test.js before running tests (see UPLOADS.md).",
);

export default defineConfig({
  name: "file-storage-s3-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["pnpm exec tsc"],
      },
      config: {
        default: {
          endpoint: MotoEndpoint,
          region: "us-east-1",
          ...TestCredentials,
          bucket: PublicBucket,
          attachmentPrivateBucket: PrivateBucket,
          publicUrl: PublicUrl,
          defaultVisibility: "private",
          defaultUploadExpiration: 3600,
          defaultReadExpiration: 300,
        },
        storages: {
          "public-assets": {
            endpoint: MotoEndpoint,
            region: "us-east-1",
            ...TestCredentials,
            bucket: PublicBucket,
            publicUrl: PublicUrl,
            defaultVisibility: "public",
            defaultUploadExpiration: 3600,
            defaultReadExpiration: 300,
          },
        },
      },
    },
  },
  test: {
    folder: "dist/test",
  },
});
