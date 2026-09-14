import { createHash, createHmac } from "node:crypto";

const SignatureParameter = "X-Amz-Signature";
const CredentialParameter = "X-Amz-Credential";
const SignedHeadersParameter = "X-Amz-SignedHeaders";
const TimestampParameter = "X-Amz-Date";
const SigningAlgorithm = "AWS4-HMAC-SHA256";
const UnsignedPayload = "UNSIGNED-PAYLOAD";
const CredentialPrefix = "AWS4";
const HeaderSeparator = ";";

function encodeQuery(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .filter(([key]) => key !== SignatureParameter)
    .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
    .sort()
    .join("&");
}

function canonicalRequest(url: URL, headers: Record<string, string>): string {
  const signedHeaders = url.searchParams.get(SignedHeadersParameter) ?? "";
  const normalized = new Headers(headers);
  normalized.set("host", url.host);
  const canonicalHeaders = signedHeaders
    .split(HeaderSeparator)
    .map(
      (name) =>
        `${name}:${normalized.get(name)?.trim().replace(/\s+/g, " ") ?? ""}\n`,
    )
    .join("");
  return [
    "PUT",
    url.pathname,
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders,
    UnsignedPayload,
  ].join("\n");
}

export function uploadSignature(
  url: URL,
  headers: Record<string, string>,
  secret: string,
): string {
  const scope = (url.searchParams.get(CredentialParameter) ?? "")
    .split("/")
    .slice(1);
  const key = scope.reduce(
    (previous, component) =>
      createHmac("sha256", previous).update(component).digest(),
    Buffer.from(`${CredentialPrefix}${secret}`),
  );
  const requestHash = createHash("sha256")
    .update(canonicalRequest(url, headers))
    .digest("hex");
  const message = [
    SigningAlgorithm,
    url.searchParams.get(TimestampParameter),
    scope.join("/"),
    requestHash,
  ].join("\n");
  return createHmac("sha256", key).update(message).digest("hex");
}
