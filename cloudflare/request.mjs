export const CREDENTIAL_HEADER = "x-gutfeel-credential";
export const CLIENT_IP_HEADER = "x-gutfeel-client-ip";

export function prepareContainerRequest(request) {
  const url = new URL(request.url);
  const forwarded = new Request(url, request);
  const { headers } = forwarded;

  // Never trust client-supplied internal forwarding headers. Cloudflare sets
  // cf-connecting-ip at the edge, and the Worker owns the two Gut Feel headers.
  headers.delete(CREDENTIAL_HEADER);
  headers.delete(CLIENT_IP_HEADER);

  const credential = url.searchParams.get("credential");
  if (credential) {
    headers.set(CREDENTIAL_HEADER, credential);
    url.searchParams.delete("credential");
  }

  const connectingIp = headers.get("cf-connecting-ip");
  if (connectingIp) headers.set(CLIENT_IP_HEADER, connectingIp);

  return new Request(url, forwarded);
}
