import type { VerifyConfig } from "@antelopejs/tooling-configs/verify";

import { configJourneys } from "./journeys-config.ts";
import { objectJourneys } from "./journeys-objects.ts";
import { smokeJourneys } from "./journeys-smoke.ts";
import { stagingJourneys } from "./journeys-staging.ts";
import { uploadJourneys } from "./journeys-upload.ts";
import { visibilityJourneys } from "./journeys-visibility.ts";
import { ACCESS_KEY, PRIVATE_BUCKET, PUBLIC_BUCKET, SECRET_KEY, SERVICE } from "./session.ts";

const MOTO_PORT = 5000;
const MOTO_URL = `http://localhost:${MOTO_PORT}`;

const config: VerifyConfig = {
  doors: {
    data: {
      globs: ["src/implementations/file-storage/**", "src/lifecycle.ts"],
      funnels: ["src/implementations/file-storage/beta.ts"],
      containments: ["objects/objects-lifecycle"],
      why: "every file an application stores goes through this adapter into a customer's bucket: the key layout, the visibility prefixes and the delete and move calls decide which objects exist and which are lost",
    },
    format: null,
    contract: {
      globs: ["package.json"],
      funnels: [],
      containments: [],
      why: "the config keys (`default`, `storages`, the bucket and expiry settings), `antelopeJs.implements` and the interface range",
    },
    outbound: null,
    exposure: {
      globs: ["src/implementations/file-storage/private-bucket.ts", "src/implementations/file-storage/beta.ts"],
      funnels: ["src/implementations/file-storage/private-bucket.ts"],
      containments: [],
      why: "private uploads and reads are routed to the private bucket only after its public access block is verified: a changed check makes private files readable by anyone",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name and release workflow claim @antelopejs/file-storage-s3 on npm",
    },
  },
  services: {
    [SERVICE]: {
      image: "motoserver/moto:5.2.3",
      port: MOTO_PORT,
      ready: ["python", "-c", `import urllib.request; urllib.request.urlopen("${MOTO_URL}")`],
      reset: ["python", "-c", `import urllib.request; urllib.request.urlopen(urllib.request.Request("${MOTO_URL}/moto-api/reset", method="POST"))`],
    },
  },
  moduleConfig(services) {
    const moto = services.find((service) => service.name === SERVICE);
    const endpoint = `http://${moto?.host}:${moto?.port}`;
    return {
      default: {
        endpoint,
        region: "us-east-1",
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        bucket: PUBLIC_BUCKET,
        attachmentPrivateBucket: PRIVATE_BUCKET,
        publicUrl: `${endpoint}/${PUBLIC_BUCKET}`,
        defaultVisibility: "public",
        defaultUploadExpiration: 3600,
        defaultReadExpiration: 300,
      },
    };
  },
  journeys: { ...uploadJourneys, ...objectJourneys, ...visibilityJourneys, ...stagingJourneys, ...configJourneys, ...smokeJourneys },
};

export default config;
