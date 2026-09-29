import assert from "node:assert/strict";
import { CreateUploadUrl } from "@antelopejs/interface-file-storage";

import { uploadSignature } from "./upload-signature";

const TestSecret = "test-secret-key";
const ConditionHeader = "If-None-Match";
const OriginHeader = "x-amz-meta-antelope-promotion-origin";
const MetadataHeaderPrefix = "x-amz-meta-";
const SignedHeadersParameter = "X-Amz-SignedHeaders";

function signedHeaders(url: URL): string[] {
  return url.searchParams.get(SignedHeadersParameter)?.split(";") ?? [];
}

function hoistedMetadata(url: URL): string[] {
  return [...url.searchParams.keys()].filter((name) =>
    name.toLowerCase().startsWith(MetadataHeaderPrefix),
  );
}

describe("create-only upload signatures", () => {
  it("strips forged promotion metadata case-insensitively and signs a non-proof sentinel", async () => {
    const response = await CreateUploadUrl({
      filename: "forged.txt",
      mimetype: "text/plain",
      size: 3,
      metadata: {
        "ANTELOPE-PROMOTION-ORIGIN": "forged",
        "antelope-promotion-extra": "forged",
        custom: "kept",
      },
    });
    assert.equal(response.headers[OriginHeader], "unpromoted");
    assert.equal(
      response.headers["x-amz-meta-antelope-promotion-extra"],
      undefined,
    );
    assert.equal(response.headers["x-amz-meta-custom"], "kept");
    const url = new URL(response.uploadUrl);
    const expected = url.searchParams.get("X-Amz-Signature");
    assert.equal(uploadSignature(url, response.headers, TestSecret), expected);
    assert.notEqual(
      uploadSignature(
        url,
        { ...response.headers, [OriginHeader]: "forged" },
        TestSecret,
      ),
      expected,
    );
  });

  it("signs camelCase metadata as lowercase headers without hoisting them", async () => {
    const response = await CreateUploadUrl({
      filename: "context.tar",
      mimetype: "application/x-tar",
      size: 3,
      metadata: { tenantId: "t", buildId: "b" },
    });
    const url = new URL(response.uploadUrl);
    const metadataHeaders = Object.keys(response.headers).filter((name) =>
      name.toLowerCase().startsWith(MetadataHeaderPrefix),
    );
    assert.deepEqual(hoistedMetadata(url), []);
    for (const name of metadataHeaders) {
      assert.ok(signedHeaders(url).includes(name), `${name} is not signed`);
      assert.equal(name, name.toLowerCase());
    }
    assert.equal(response.headers["x-amz-meta-tenantid"], "t");
    assert.equal(response.headers["x-amz-meta-buildid"], "b");
    assert.equal(
      uploadSignature(url, response.headers, TestSecret),
      url.searchParams.get("X-Amz-Signature"),
    );
  });

  it("rejects metadata keys that collide once lowercased", async () => {
    await assert.rejects(
      CreateUploadUrl({
        filename: "context.tar",
        mimetype: "application/x-tar",
        size: 3,
        metadata: { tenantId: "a", tenantid: "b" },
      }),
      /tenantid/,
    );
  });

  it("requires the signed create-only header for ordinary and staged uploads", async () => {
    for (const staging of [false, true]) {
      const response = await CreateUploadUrl({
        filename: "file.txt",
        mimetype: "text/plain",
        size: 3,
        staging,
        metadata: { source: "signed-metadata" },
      });
      const url = new URL(response.uploadUrl);
      assert.equal(response.headers[ConditionHeader], "*");
      assert.ok(
        url.searchParams
          .get("X-Amz-SignedHeaders")
          ?.split(";")
          .includes("if-none-match"),
      );
      const expected = url.searchParams.get("X-Amz-Signature");
      assert.equal(
        uploadSignature(url, response.headers, TestSecret),
        expected,
      );
      const omitted = { ...response.headers };
      delete omitted[ConditionHeader];
      assert.notEqual(uploadSignature(url, omitted, TestSecret), expected);
      const altered = { ...response.headers, [ConditionHeader]: "other" };
      assert.notEqual(uploadSignature(url, altered, TestSecret), expected);
    }
  });

  it("preserves explicit public storage selection with create-only uploads", async () => {
    const response = await CreateUploadUrl(
      {
        filename: "public.txt",
        mimetype: "text/plain",
        size: 3,
      },
      undefined,
      "public-assets",
    );
    const url = new URL(response.uploadUrl);
    assert.ok(`${url.host}${url.pathname}`.includes("public-bucket"));
    assert.equal(response.headers[ConditionHeader], "*");
    assert.equal(
      uploadSignature(url, response.headers, TestSecret),
      url.searchParams.get("X-Amz-Signature"),
    );
  });
});
