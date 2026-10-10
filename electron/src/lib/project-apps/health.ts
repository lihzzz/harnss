import net from "node:net";
import http from "node:http";
import https from "node:https";
import type { AppLaunchProfile } from "@shared/types/project-apps";
import { ProductivityError } from "../productivity-errors";

export function isLoopbackUrl(value: string): boolean {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
export async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
  });
}
export async function selectPort(profile: AppLaunchProfile, ownedPort: number | null = null): Promise<number | null> {
  if (profile.port.kind === "none") {
    // A custom HTTP command still must not claim an already running service as
    // its own merely because that unrelated endpoint passes a health check.
    if (profile.readiness.kind === "http" && isLoopbackUrl(profile.previewUrl)) {
      const url = new URL(profile.previewUrl);
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (port !== ownedPort && !await portAvailable(port)) throw new ProductivityError("PORT_IN_USE", `Preview port ${port} is already in use`, true);
    }
    return null;
  }
  const preferred = profile.port.kind === "fixed" ? profile.port.port : profile.port.preferred;
  if (await portAvailable(preferred)) return preferred;
  if (profile.port.kind === "fixed") throw new ProductivityError("PORT_IN_USE", `Port ${preferred} is already in use`, true);
  for (let offset = 1; offset <= 100; offset++) {
    const candidate = preferred + offset;
    if (candidate <= 65535 && await portAvailable(candidate)) return candidate;
  }
  throw new ProductivityError("PORT_IN_USE", "No available port in the requested range", true);
}
export function validateReadinessTarget(profile: AppLaunchProfile, port: number | null): string | null {
  const preview = profile.previewUrl ? profile.previewUrl.replaceAll("{port}", String(port ?? "")) : null;
  if (profile.readiness.kind !== "http") return preview;
  if (!preview || !isLoopbackUrl(preview)) throw new ProductivityError("INVALID_TARGET", "HTTP readiness requires a loopback preview URL");
  const url = new URL(preview);
  const urlPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (port !== null && urlPort !== port) throw new ProductivityError("INVALID_ARGUMENT", "The health check URL must use the configured service port");
  return preview;
}
export interface HttpReadinessResult { ready: boolean; address: string | null }
export function checkHttp(urlText: string, profile: AppLaunchProfile, signal: AbortSignal): Promise<HttpReadinessResult> {
  if (profile.readiness.kind !== "http") return Promise.resolve({ ready: false, address: null });
  const url = new URL(profile.readiness.path, urlText);
  if (!isLoopbackUrl(url.href) || url.origin !== new URL(urlText).origin) return Promise.reject(new ProductivityError("INVALID_TARGET", "Readiness checks must stay on the configured loopback origin"));
  const accepted = profile.readiness.acceptedStatuses;
  return new Promise((resolve) => {
    if (signal.aborted) { resolve({ ready: false, address: null }); return; }
    // No redirect following, credentials, response buffering, or proxy environment.
    const request = (url.protocol === "https:" ? https : http).get(url, { signal, timeout: 2000 }, (response) => {
      const redirect = response.headers.location;
      let validRedirect = true;
      if (redirect) {
        try { const target = new URL(redirect, url); validRedirect = target.origin === url.origin && isLoopbackUrl(target.href); }
        catch { validRedirect = false; }
      }
      resolve({ ready: validRedirect && accepted.includes(response.statusCode ?? 0), address: response.socket.remoteAddress ?? null });
      response.destroy();
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve({ ready: false, address: null }));
  });
}
