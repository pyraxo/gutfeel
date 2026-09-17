import { Container, getContainer } from "@cloudflare/containers";
import { prepareContainerRequest } from "./request.mjs";

const CONTAINER_NAME = "gutfeel-production";

export class GutFeelContainer extends Container {
  defaultPort = 4173;
  requiredPorts = [4173];

  // Gut Feel keeps active lobbies and relay membership in process memory.
  // Cloudflare Container WebSocket frames currently do not reliably renew the
  // activity timeout, so this singleton intentionally remains running.
  sleepAfter = "1h";

  envVars = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "4173",
    PUBLIC_ORIGIN: "https://gutfeel.atzy.dev",
    SOURCE_CODE_URL: "https://github.com/pyraxo/gutfeel",
    TRUST_CLOUDFLARE_CONNECTING_IP: "1",
  };

  enableInternet = false;
  pingEndpoint = "localhost:4173/health";

  async onActivityExpired() {
    // Keeping the hook alive renews the timer without stopping the container.
    // A future persistent lobby store can restore normal scale-to-zero here.
  }
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.GUTFEEL_CONTAINER, CONTAINER_NAME);
    const response = await container.fetch(prepareContainerRequest(request));

    // A WebSocket upgrade response carries an attached socket and must be
    // returned untouched.
    if (response.status === 101) return response;

    const headers = new Headers(response.headers);
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("X-Frame-Options", "SAMEORIGIN");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
