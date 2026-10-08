/** Runtime diagnostics for Harnss' engine-independent computer-use bridge. */
export interface ComputerUseRuntimeStatus {
  /** Whether new engine sessions should receive the Cua Driver MCP server. */
  enabled: boolean;
  /** Resolved executable path or command name. */
  command: string;
  /** Internal SDK proxy or an explicitly configured external driver. */
  mode: "internal" | "external";
  /** Whether the executable can be launched. */
  installed: boolean;
  /** Whether the runtime is usable for new sessions. */
  ready: boolean;
  /** Version reported by the driver, when available. */
  version?: string;
  permissions?: {
    accessibility: boolean;
    screenRecording: boolean;
  };
  error?: string;
}
