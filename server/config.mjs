import { isIP } from "node:net";

function normalizeAddress(value) {
  const address = String(value ?? "").trim();
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4)
    return address.slice(7);
  return isIP(address) ? address.toLowerCase() : "";
}

export function normalizePublicOrigin(value, { required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (required) throw new Error("PUBLIC_ORIGIN is required when NODE_ENV=production");
    return "";
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("PUBLIC_ORIGIN must be a valid URL origin"); }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) throw new Error("PUBLIC_ORIGIN must be one HTTP(S) origin without path, query, or credentials");
  return url.origin;
}

export function normalizeSourceCodeUrl(value, { required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (required) throw new Error("SOURCE_CODE_URL is required when NODE_ENV=production");
    return "";
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("SOURCE_CODE_URL must be a valid HTTP(S) URL"); }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password
  ) throw new Error("SOURCE_CODE_URL must be an HTTP(S) URL without credentials");
  return url.href;
}

export function parseTrustedProxyAddresses(value) {
  const addresses = new Set();
  for (const candidate of String(value ?? "").split(",")) {
    if (!candidate.trim()) continue;
    const address = normalizeAddress(candidate);
    if (!address) throw new Error(`TRUSTED_PROXY_IPS contains an invalid IP address: ${candidate.trim()}`);
    addresses.add(address);
  }
  return addresses;
}

export function clientAddress(request, trustedProxyAddresses = new Set()) {
  const peer = normalizeAddress(request.socket?.remoteAddress) || "unknown";
  if (!trustedProxyAddresses.has(peer)) return peer;
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "");
  if (!forwarded) return peer;
  const chain = forwarded.split(",").map(normalizeAddress);
  if (chain.some((address) => !address)) return peer;
  chain.push(peer);
  while (chain.length > 1 && trustedProxyAddresses.has(chain.at(-1))) chain.pop();
  return chain.at(-1) || peer;
}

export function serverConfiguration(options = {}, environment = process.env) {
  const production = options.production ?? environment.NODE_ENV === "production";
  const publicOrigin = normalizePublicOrigin(
    options.publicOrigin ?? environment.PUBLIC_ORIGIN,
    { required: production },
  );
  const sourceCodeUrl = normalizeSourceCodeUrl(
    options.sourceCodeUrl ?? environment.SOURCE_CODE_URL,
    { required: production },
  );
  const trustedProxyAddresses = options.trustedProxyAddresses instanceof Set
    ? options.trustedProxyAddresses
    : parseTrustedProxyAddresses(
      options.trustedProxyAddresses ?? environment.TRUSTED_PROXY_IPS,
    );
  return { production, publicOrigin, sourceCodeUrl, trustedProxyAddresses };
}
