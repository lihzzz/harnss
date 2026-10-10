import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { McpServerInput } from "@shared/lib/mcp-config";
import { appId, appNumber, appRecord, appString, validateProjectAppInput, validateWorkspaceBinding } from "@shared/lib/project-apps";
import type { AppCatalogSnapshot, AppRun, ProjectApp } from "@shared/types/project-apps";
import type { ProjectAppAgentPermissionEvent, ProjectAppAgentPermissionRequest, ProjectAppAgentPermissionResponse } from "@shared/types/project-app-agent";
import type { WorkspaceBinding } from "@shared/types/workspace";
import { ProductivityError } from "../productivity-errors";
import type { ProjectAppsService } from "./service";
import { containsPath, pathIdentity } from "./workspace";

export const PROJECT_APPS_MCP_SERVER_NAME = "harnss_apps";
type Service = Pick<ProjectAppsService, "workspaces" | "validateWorkspace" | "list" | "discover" | "save" | "start" | "stop" | "restart" | "remove" | "logs">;
interface Scope { sessionId: string; projectId: string; cwd: string; workspace: WorkspaceBinding; token: string; expiresAt: number; expiryTimer: ReturnType<typeof setTimeout> }
interface Pending { request: ProjectAppAgentPermissionRequest; finish: (allow: boolean) => void }
interface PreparedMutation { details: Record<string, unknown>; execute: () => Promise<unknown> }
const READ_TOOLS = new Set(["apps_list", "apps_get", "apps_status", "apps_logs", "apps_discover"]);
const MUTATION_TOOLS = new Set(["apps_register", "apps_add", "apps_update", "apps_start", "apps_stop", "apps_restart", "apps_remove"]);

/** Owns only authentication and approvals; all application state stays in ProjectAppsService. */
export class ProjectAppAgentBridge {
  private server: http.Server | null = null;
  private starting: Promise<string> | null = null;
  private baseUrl = "";
  private closed = false;
  private readonly scopes = new Map<string, Scope>();
  private readonly tokens = new Map<string, Scope>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: ProjectAppAgentPermissionEvent) => void>();
  constructor(private readonly service: Service, private readonly approvalTimeoutMs = 120_000, private readonly tokenTtlMs = 60 * 60 * 1000) {}

  onPermission(listener: (event: ProjectAppAgentPermissionEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(event: ProjectAppAgentPermissionEvent): void {
    for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { /* A closed UI never grants a request. */ } }
  }
  pendingPermissions(): ProjectAppAgentPermissionRequest[] {
    return [...this.pending.values()].map(({ request }) => structuredClone(request));
  }
  respond(value: ProjectAppAgentPermissionResponse): null {
    const entry = this.pending.get(value.requestId);
    if (!entry || entry.request.sessionId !== value.sessionId || typeof value.allow !== "boolean") {
      throw new ProductivityError("APPROVAL_EXPIRED", "This application permission request is no longer pending.");
    }
    entry.finish(value.allow); return null;
  }
  private active(scope: Scope): void {
    if (Date.now() >= scope.expiresAt) this.revoke(scope.sessionId);
    if (this.closed || this.scopes.get(scope.sessionId) !== scope) throw new ProductivityError("SESSION_REVOKED", "The application tool session has stopped.");
  }
  getProjectId(sessionId: string): string | undefined { return this.scopes.get(sessionId)?.projectId; }
  revoke(sessionId: string): void {
    const scope = this.scopes.get(sessionId);
    if (scope) { clearTimeout(scope.expiryTimer); this.tokens.delete(scope.token); this.scopes.delete(sessionId); }
    this.cancelPermissions(sessionId);
  }
  cancelPermissions(sessionId: string): void {
    for (const entry of this.pending.values()) if (entry.request.sessionId === sessionId) entry.finish(false);
  }
  async register(sessionId: string, projectId: string, cwd: string): Promise<McpServerInput> {
    if (this.closed) throw new ProductivityError("SESSION_REVOKED", "Application tools are shutting down.");
    const canonicalCwd = await fs.realpath(cwd);
    const workspaces = await this.service.workspaces(projectId);
    const workspace = workspaces.filter((entry) => containsPath(entry.rootPath, canonicalCwd))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
    if (!workspace) throw new ProductivityError("INVALID_TARGET", "The conversation directory is not part of its project.");
    const resolved = await this.service.validateWorkspace({ ...workspace, relativeCwd: path.relative(workspace.rootPath, canonicalCwd) });
    const url = await this.listen();
    if (this.closed) throw new ProductivityError("SESSION_REVOKED");
    this.revoke(sessionId);
    const expiryTimer = setTimeout(() => this.revoke(sessionId), this.tokenTtlMs);
    expiryTimer.unref();
    const scope: Scope = { sessionId, projectId, cwd: resolved.cwd, workspace: resolved.workspace,
      token: randomBytes(32).toString("hex"), expiresAt: Date.now() + this.tokenTtlMs, expiryTimer };
    this.scopes.set(sessionId, scope); this.tokens.set(scope.token, scope);
    return this.definition(scope, url);
  }
  definitionFor(sessionId: string): McpServerInput | null {
    const scope = this.scopes.get(sessionId); return scope ? this.definition(scope, this.baseUrl) : null;
  }
  private definition(scope: Scope, url: string): McpServerInput {
    return { name: PROJECT_APPS_MCP_SERVER_NAME, transport: "stdio", command: process.execPath,
      args: [path.join(__dirname, "project-apps-mcp.js")], env: { ELECTRON_RUN_AS_NODE: "1",
        HARNSS_PROJECT_APPS_URL: url, HARNSS_PROJECT_APPS_TOKEN: scope.token } };
  }
  private inScope(scope: Scope, workspace: WorkspaceBinding): boolean {
    return workspace.projectId === scope.projectId
      && pathIdentity(workspace.rootPath) === pathIdentity(scope.workspace.rootPath)
      && containsPath(scope.cwd, path.resolve(workspace.rootPath, workspace.relativeCwd));
  }
  private ownedApp(scope: Scope, snapshot: AppCatalogSnapshot, id: unknown): Extract<ProjectApp, { kind: "managed" }> {
    const app = snapshot.apps.find((entry) => entry.id === appId(id));
    if (!app || app.kind !== "managed" || !this.inScope(scope, app.workspace)) {
      throw new ProductivityError("OUT_OF_SCOPE", "This application is outside the conversation workspace.");
    }
    return app;
  }
  private ownedRun(scope: Scope, snapshot: AppCatalogSnapshot, id: unknown): AppRun {
    const run = snapshot.runs.find((entry) => entry.runId === appId(id));
    if (!run || !this.inScope(scope, run.workspace)) throw new ProductivityError("OUT_OF_SCOPE", "This run is outside the conversation workspace.");
    return run;
  }
  private async target(scope: Scope, value: unknown): Promise<WorkspaceBinding> {
    const candidate = validateWorkspaceBinding(value);
    if (!this.inScope(scope, candidate)) throw new ProductivityError("OUT_OF_SCOPE", "This directory is outside the conversation workspace.");
    const resolved = await this.service.validateWorkspace(candidate);
    this.active(scope);
    if (!this.inScope(scope, resolved.workspace) || !containsPath(scope.cwd, resolved.cwd)) throw new ProductivityError("OUT_OF_SCOPE");
    return resolved.workspace;
  }
  private async prepare(scope: Scope, tool: string, args: Record<string, unknown>): Promise<PreparedMutation> {
    this.active(scope);
    if (tool === "apps_register") tool = args.appId === undefined ? "apps_add" : "apps_update";
    const snapshot = await this.service.list(); this.active(scope);
    const requestId = randomUUID();
    if (tool === "apps_add" || tool === "apps_update") {
      const app = tool === "apps_update" ? this.ownedApp(scope, snapshot, args.appId) : null;
      if (app && snapshot.runs.some((run) => run.appId === app.id && !this.inScope(scope, run.workspace))) throw new ProductivityError("OUT_OF_SCOPE", "This application has runs in another workspace.");
      const definition = validateProjectAppInput(args.definition);
      if (definition.kind !== "managed") throw new ProductivityError("OUT_OF_SCOPE", "Agent tools only manage project applications.");
      const workspace = await this.target(scope, definition.workspace);
      if (definition.projectId !== scope.projectId) throw new ProductivityError("OUT_OF_SCOPE");
      const input = { id: app?.id ?? null, expectedRevision: app ? appNumber(args.expectedRevision, "revision", 1, Number.MAX_SAFE_INTEGER) : null,
        definition: { ...definition, workspace }, agentScope: scope.workspace };
      const before = app ? validateProjectAppInput(app) : null;
      const previousFields = new Map(Object.entries(before ?? {}));
      const changedFields = Object.entries(input.definition)
        .filter(([key, value]) => JSON.stringify(previousFields.get(key)) !== JSON.stringify(value))
        .map(([key]) => key);
      return { details: { ...input, before, after: input.definition, changedFields },
        execute: () => this.service.save(input, () => this.active(scope)) };
    }
    if (tool === "apps_start") {
      const app = this.ownedApp(scope, snapshot, args.appId);
      const workspace = await this.target(scope, args.workspace ?? app.workspace);
      const input = { appId: app.id, expectedRevision: appNumber(args.expectedRevision, "revision", 1, Number.MAX_SAFE_INTEGER), workspace, requestId, agentScope: scope.workspace };
      return { details: { ...input, launch: app.launch }, execute: () => this.service.start(input, () => this.active(scope)) };
    }
    if (tool === "apps_remove") {
      const app = this.ownedApp(scope, snapshot, args.appId);
      if (snapshot.runs.some((run) => run.appId === app.id && !this.inScope(scope, run.workspace))) throw new ProductivityError("OUT_OF_SCOPE", "This application has runs in another workspace.");
      const input = { appId: app.id, expectedRevision: appNumber(args.expectedRevision, "revision", 1, Number.MAX_SAFE_INTEGER), agentScope: scope.workspace };
      return { details: { ...input, application: app }, execute: () => this.service.remove(input, () => this.active(scope)) };
    }
    const run = this.ownedRun(scope, snapshot, args.runId);
    if (tool === "apps_stop") {
      const input = { runId: run.runId, requestId, agentScope: scope.workspace };
      return { details: { ...input, run }, execute: () => this.service.stop(input, () => this.active(scope)) };
    }
    const app = this.ownedApp(scope, snapshot, run.appId);
    await this.target(scope, { ...run.workspace, relativeCwd: app.workspace.relativeCwd });
    const input = { runId: run.runId, expectedRevision: appNumber(args.expectedRevision, "revision", 1, Number.MAX_SAFE_INTEGER), requestId, agentScope: scope.workspace };
    return { details: { ...input, launch: app.launch, workspace: run.workspace }, execute: () => this.service.restart(input, () => this.active(scope)) };
  }
  private approve(scope: Scope, tool: string, args: Record<string, unknown>): Promise<void> {
    this.active(scope);
    if (this.pending.size >= 100 || [...this.pending.values()].filter((entry) => entry.request.sessionId === scope.sessionId).length >= 5) {
      throw new ProductivityError("CAPACITY_REACHED", "Too many application permission requests are pending.");
    }
    return new Promise((resolve, reject) => {
      const createdAt = Date.now();
      const request: ProjectAppAgentPermissionRequest = { requestId: randomUUID(), sessionId: scope.sessionId,
        projectId: scope.projectId, cwd: scope.cwd, tool, args: structuredClone(args), createdAt, expiresAt: createdAt + this.approvalTimeoutMs };
      const timer = setTimeout(() => finish(false), this.approvalTimeoutMs);
      const finish = (allow: boolean) => {
        if (!this.pending.delete(request.requestId)) return;
        clearTimeout(timer);
        this.emit({ kind: "resolved", requestId: request.requestId, sessionId: scope.sessionId });
        if (!allow) reject(new ProductivityError("APPROVAL_DENIED", "The application action was denied, expired, or its conversation stopped."));
        else { try { this.active(scope); resolve(); } catch (error) { reject(error); } }
      };
      this.pending.set(request.requestId, { request, finish });
      this.emit({ kind: "requested", request });
    });
  }
  async call(token: string, value: unknown): Promise<unknown> {
    const scope = this.tokens.get(token);
    if (!scope) throw new ProductivityError("UNAUTHORIZED", "Invalid or expired application tool session.");
    this.active(scope);
    const input = appRecord(value); const tool = appString(input.tool, "tool", 100); const args = appRecord(input.args ?? {});
    if (MUTATION_TOOLS.has(tool)) {
      const prepared = await this.prepare(scope, tool, args);
      await this.approve(scope, tool, prepared.details);
      // Re-read configuration and scope after the UI wait. An approval authorizes
      // exactly this revision; callers must request approval again if it changed.
      const current = await this.prepare(scope, tool, args);
      const comparable = (details: Record<string, unknown>) => JSON.stringify({ ...details, requestId: undefined });
      if (comparable(prepared.details) !== comparable(current.details)) throw new ProductivityError("CONFIG_CONFLICT", "The application changed while approval was pending. Review and retry.");
      this.active(scope); return current.execute();
    }
    if (!READ_TOOLS.has(tool)) throw new ProductivityError("INVALID_ARGUMENT", "Unknown application tool.");
    if (tool === "apps_discover") {
      const discovery = await this.service.discover(await this.target(scope, args.workspace ?? scope.workspace));
      this.active(scope); return discovery;
    }
    const snapshot = await this.service.list(); this.active(scope);
    if (tool === "apps_list") return { workspace: scope.workspace, toolSessionExpiresAt: scope.expiresAt,
      apps: snapshot.apps.filter((app) => app.kind === "managed" && this.inScope(scope, app.workspace)),
      runs: snapshot.runs.filter((run) => this.inScope(scope, run.workspace)) };
    if (tool === "apps_get") {
      const app = this.ownedApp(scope, snapshot, args.appId);
      return { app, runs: snapshot.runs.filter((run) => run.appId === app.id && this.inScope(scope, run.workspace)) };
    }
    const run = this.ownedRun(scope, snapshot, args.runId);
    if (tool === "apps_status") return run;
    const page = await this.service.logs({ runId: run.runId, afterSeq: args.afterSeq ?? 0, limit: appNumber(args.limit ?? 100, "log limit", 1, 200) });
    this.active(scope);
    let remaining = 16_000;
    const entries = [];
    let truncated = page.truncated;
    for (const entry of page.entries) {
      if (remaining <= 0) { truncated = true; break; }
      const text = entry.text.slice(0, remaining);
      if (text.length < entry.text.length) truncated = true;
      entries.push({ ...entry, text }); remaining -= text.length;
    }
    return { ...page, entries, nextSeq: entries.at(-1)?.seq ?? page.nextSeq, truncated };
  }
  private listen(): Promise<string> {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => { void this.handleHttp(request, response); });
      server.requestTimeout = 150_000; server.headersTimeout = 10_000;
      this.server = server;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") { reject(new Error("Application tool bridge failed to bind.")); return; }
        this.baseUrl = `http://127.0.0.1:${address.port}/call`; resolve(this.baseUrl);
      });
    });
    return this.starting;
  }
  private async handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
    if (request.method !== "POST" || request.url !== "/call" || request.headers.origin || request.socket.remoteAddress !== "127.0.0.1") {
      send(403, { error: { code: "FORBIDDEN", message: "Application tools only accept authenticated local requests." } }); return;
    }
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!this.tokens.has(token)) { send(401, { error: { code: "UNAUTHORIZED", message: "Invalid application tool session." } }); return; }
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += data.length;
        if (length > 65_536) { send(413, { error: { code: "TOO_LARGE", message: "Application tool request exceeds 64 KiB." } }); return; }
        chunks.push(data);
      }
      const result = await this.call(token, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      send(200, { value: result });
    } catch (error) {
      send(error instanceof ProductivityError && error.code === "UNAUTHORIZED" ? 401 : 400,
        { error: { code: error instanceof ProductivityError ? error.code : "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } });
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const sessionId of this.scopes.keys()) this.revoke(sessionId);
    const server = this.server;
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    this.server = null;
  }
}

let bridge: ProjectAppAgentBridge | null = null;
let shuttingDown = false;
const permissionListeners = new Set<(event: ProjectAppAgentPermissionEvent) => void>();
async function instance(): Promise<ProjectAppAgentBridge> {
  if (shuttingDown) throw new ProductivityError("SESSION_REVOKED", "Application tools are shutting down.");
  if (!bridge) {
    const { getProjectAppsService } = await import("./index");
    if (shuttingDown) throw new ProductivityError("SESSION_REVOKED", "Application tools are shutting down.");
    if (!bridge) {
      bridge = new ProjectAppAgentBridge(getProjectAppsService());
      bridge.onPermission((event) => { for (const listener of permissionListeners) listener(event); });
    }
  }
  return bridge;
}
export async function registerProjectAppAgentSession(sessionId: string, projectId: string | undefined, cwd: string): Promise<void> {
  if (!projectId) return;
  await (await instance()).register(sessionId, projectId, cwd);
}
export function revokeProjectAppAgentSession(sessionId: string): void { bridge?.revoke(sessionId); }
export function cancelProjectAppAgentPermissions(sessionId: string): void { bridge?.cancelPermissions(sessionId); }
export function getProjectAppAgentProjectId(sessionId: string): string | undefined { return bridge?.getProjectId(sessionId); }
export function withProjectAppMcpServer(servers: McpServerInput[] | undefined, sessionId: string): McpServerInput[] {
  const server = bridge?.definitionFor(sessionId);
  const existing = (servers ?? []).filter((entry) => entry.name !== PROJECT_APPS_MCP_SERVER_NAME);
  return server ? [...existing, server] : existing;
}
export function getProjectAppMcpServer(sessionId: string): McpServerInput | null { return bridge?.definitionFor(sessionId) ?? null; }
export function pendingProjectAppPermissions(): ProjectAppAgentPermissionRequest[] { return bridge?.pendingPermissions() ?? []; }
export function respondProjectAppPermission(response: ProjectAppAgentPermissionResponse): null {
  if (!bridge) throw new ProductivityError("APPROVAL_EXPIRED");
  return bridge.respond(response);
}
export function onProjectAppPermission(listener: (event: ProjectAppAgentPermissionEvent) => void): () => void {
  permissionListeners.add(listener); return () => { permissionListeners.delete(listener); };
}
export async function shutdownProjectAppAgentBridge(): Promise<void> { shuttingDown = true; await bridge?.shutdown(); bridge = null; }
