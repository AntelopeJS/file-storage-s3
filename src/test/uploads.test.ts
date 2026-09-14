import assert from "node:assert/strict";
import { CreateUploadUrl } from "@antelopejs/interface-file-storage";

import { uploadSignature } from "./upload-signature";

const TestSecret = "test-secret-key";
const ConditionHeader = "If-None-Match";

describe("create-only upload signatures", () => {
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
