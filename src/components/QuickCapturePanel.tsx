import { memo, useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { InstalledAgent, Project } from "@/types";
import type { QuickCaptureRequest, QuickCaptureTarget } from "@shared/types/productivity";

/** Nonmodal so users can finish a draft or authentication without losing the captured request. */
export const QuickCapturePanel = memo(function QuickCapturePanel({ request, projects, agents, onContinue, onDismiss, onCreateProject, onOpenSettings }: {
  request: QuickCaptureRequest; projects: Project[]; agents: InstalledAgent[];
  onContinue: (target?: QuickCaptureTarget) => Promise<void>; onDismiss: () => Promise<void>;
  onCreateProject: () => Promise<void>; onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState(request.target?.projectId ?? "");
  const [agentId, setAgentId] = useState(request.target?.agentId ?? "");
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparing = request.state === "waitingUI" || request.state === "ready" || request.state === "dispatched";
  const chooseTarget = request.action === "analyzeClipboard" || request.error?.code === "INVALID_TARGET";
  const canContinue = !request.dispatchAccepted && (request.state === "awaitingUser" || request.state === "failed" && request.error?.retryable)
    && (!chooseTarget || (projects.some((entry) => entry.id === projectId) && agents.some((entry) => entry.id === agentId)));
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const dismiss = useCallback(async () => {
    if (dismissing) return;
    setDismissing(true); setError(null);
    try { await onDismiss(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDismissing(false); }
  }, [onDismiss, dismissing]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      void dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);
  return <section role="region" aria-label={t("Quick input")} aria-busy={preparing || busy} className="fixed bottom-4 right-4 z-40 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-4 shadow-xl">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-medium">{t(request.action === "analyzeClipboard" ? "Analyze clipboard" : request.action === "dictate" ? "Wake and dictate" : "Wake and type")}</h2>
      <Button size="icon" variant="ghost" aria-label={t("Dismiss")} disabled={dismissing} onClick={() => { void dismiss(); }}><X className="size-4" /></Button>
    </div>
    <p className="my-2 text-sm text-muted-foreground" role="status">{t(request.error?.message ?? (preparing ? "Preparing quick input…" : "Choose a project and agent for quick input."))}</p>
    {request.dispatchAccepted && <p className="my-2 text-sm">{t("The request was accepted. Check its conversation before starting another analysis.")}</p>}
    {chooseTarget && !request.dispatchAccepted && <div className="my-3 grid grid-cols-2 gap-2">
      <label className="text-xs">{t("Project")}<select aria-label={t("Project")} autoFocus={request.error?.code === "INVALID_TARGET"} className="mt-1 w-full rounded-md border bg-background p-2 text-sm" disabled={busy || preparing || dismissing} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
        <option value="">{t("Choose project")}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label className="text-xs">{t("Agent")}<select aria-label={t("Agent")} className="mt-1 w-full rounded-md border bg-background p-2 text-sm" disabled={busy || preparing || dismissing} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
        <option value="">{t("Choose agent")}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
    </div>}
    {request.clipboardText && <details className="my-2 text-xs"><summary>{t("Captured text")}</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">{request.clipboardText}</pre></details>}
    {error && <p role="alert" className="my-2 text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {!projects.length && <Button size="sm" variant="outline" disabled={busy || preparing || dismissing} onClick={() => { void act(onCreateProject); }}>{t("Create project")}</Button>}
      {request.error?.code === "AUTH_REQUIRED" && <Button size="sm" variant="outline" onClick={onOpenSettings}>{t("Agent settings")}</Button>}
      <Button size="sm" variant="outline" disabled={dismissing} onClick={() => { void dismiss(); }}>{t(request.dispatchAccepted ? "Dismiss" : "Cancel")}</Button>
      {!request.dispatchAccepted && <Button size="sm" disabled={busy || dismissing || !canContinue} onClick={() => { void act(() => onContinue(chooseTarget ? { projectId, agentId } : undefined)); }}>{t("Continue")}</Button>}
    </div>
  </section>;
});
