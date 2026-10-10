/** One immutable, host-authorized application mutation. Never authorizes later calls. */
export interface ProjectAppAgentPermissionRequest {
  requestId: string;
  sessionId: string;
  projectId: string;
  cwd: string;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}
export type ProjectAppAgentPermissionEvent =
  | { kind: "requested"; request: ProjectAppAgentPermissionRequest }
  | { kind: "resolved"; requestId: string; sessionId: string };
export interface ProjectAppAgentPermissionResponse {
  requestId: string;
  sessionId: string;
  allow: boolean;
}
