import { useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, CircleDashed, Clipboard, Clock3, GitPullRequest, Inbox, LoaderCircle, MessageSquare, Send, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import type { AttentionItem, ChatSession, EngineId, HandoffPurpose, Project, ReviewComment, ReviewSnapshot } from "@/types";
import { deriveAttentionItems, deriveExecutionPhase, getAttentionPriority } from "@/lib/workflow/attention";
import { makeWorkflowId, workflowStore } from "@/lib/workflow/workflow-store";
import { parseUnifiedDiff } from "@/lib/workflow/unified-diff";

type Tab = "inbox" | "review" | "handoff";

interface WorkflowCenterProps {
  sessions: ChatSession[];
  projects: Project[];
  activeSessionId: string | null;
  activeMessages: Array<{ id: string; role: string; content: string; timestamp: number }>;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
  onHandoff?: (input: { targetEngine: EngineId; purpose: HandoffPurpose; prompt: string }) => Promise<{ targetConversationId?: string; targetSessionId?: string; error?: string }>;
}

function engineLabel(engine?: EngineId): string {
  return engine === "claude" ? "Claude" : engine === "codex" ? "Codex" : "ACP";
}

function priorityLabel(priority?: AttentionItem["priority"]): string {
  return priority === "critical" ? "Now" : priority === "high" ? "High" : priority === "normal" ? "Soon" : "Watch";
}

function phaseLabel(phase: ReturnType<typeof deriveExecutionPhase>): string {
  return phase === "waiting_permission" ? "Waiting for permission"
    : phase === "waiting_user" ? "Waiting for your answer"
      : phase === "blocked" ? "Blocked"
        : phase === "completed" ? "Completed"
          : phase === "failed" ? "Failed"
            : phase === "running" ? "Working now" : "Idle";
}

function PhaseIcon({ phase }: { phase: ReturnType<typeof deriveExecutionPhase> }) {
  if (phase === "waiting_permission") return <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />;
  if (phase === "blocked" || phase === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  if (phase === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (phase === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />;
}

function useWorkflowState() {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getState, workflowStore.getState);
}

export function WorkflowCenter({
  sessions,
  projects,
  activeSessionId,
  activeMessages,
  onSelectSession,
  onClose,
  onHandoff,
}: WorkflowCenterProps) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [selectedAttentionId, setSelectedAttentionId] = useState<string | null>(null);
  const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentLocation, setCommentLocation] = useState<{ filePath: string; group?: "staged" | "unstaged" | "untracked"; line: number; side: "old" | "new"; text: string } | null>(null);
  const [targetEngine, setTargetEngine] = useState<EngineId>("codex");
  const [purpose, setPurpose] = useState<HandoffPurpose>("review");
  const [isSending, setIsSending] = useState(false);
  const handoffProcessingSeen = useRef(new Set<string>());
  const workflow = useWorkflowState();
  const derivedAttention = deriveAttentionItems(sessions);
  const attention = useMemo(() => {
    const manualById = new Map(workflow.attention.map((item) => [item.id, item]));
    const workflowDerived: AttentionItem[] = [];
    workflow.comments
      .filter((comment) => comment.status === "draft" || comment.status === "pending" || comment.status === "needs_review")
      .forEach((comment) => {
        const session = sessions.find((entry) => entry.conversationId === comment.conversationId || entry.id === comment.conversationId);
        if (!session) return;
        const snapshot = workflow.snapshots.find((entry) => entry.id === comment.snapshotId);
        workflowDerived.push({
          id: `review:${comment.id}`,
          conversationId: session.conversationId ?? session.id,
          sessionId: session.id,
          projectId: snapshot?.projectId ?? session.projectId,
          title: "Review feedback ready",
          summary: `${comment.filePath}:${comment.range.start} · ${comment.body}`,
          kind: "review",
          status: "open",
          priority: comment.category === "problem" ? "high" : "normal",
          phase: "waiting_user",
          actionLabel: "Open review",
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        });
      });
    workflow.handoffs
      .filter((handoff) => handoff.status === "failed")
      .forEach((handoff) => {
        const session = sessions.find((entry) => entry.id === handoff.sourceSessionId || entry.conversationId === handoff.sourceConversationId);
        if (!session) return;
        workflowDerived.push({
          id: `handoff:${handoff.id}`,
          conversationId: handoff.sourceConversationId,
          sessionId: session.id,
          projectId: handoff.projectId,
          title: "Handoff needs attention",
          summary: handoff.error ?? `Could not start the ${engineLabel(handoff.targetEngine)} handoff.`,
          kind: "handoff",
          status: "open",
          priority: "high",
          phase: "failed",
          actionLabel: "Open handoff",
          isBlocking: true,
          createdAt: handoff.createdAt,
          updatedAt: handoff.updatedAt,
        });
      });
    const merged = [...derivedAttention, ...workflowDerived].map((item) => {
      const persisted = manualById.get(item.id);
      return persisted
        ? { ...item, status: persisted.status, updatedAt: persisted.updatedAt }
        : item;
    });
    const derivedIds = new Set([...derivedAttention, ...workflowDerived].map((item) => item.id));
    const manual = workflow.attention.filter((item) => !derivedIds.has(item.id));
    return [...merged, ...manual]
      .filter((item) => item.status !== "dismissed" && item.status !== "resolved")
      .sort((a, b) => getAttentionPriority(a) - getAttentionPriority(b) || b.updatedAt - a.updatedAt);
  }, [derivedAttention, sessions, workflow.attention, workflow.comments, workflow.handoffs, workflow.snapshots]);
  const actionItems = attention.filter((item) => item.status === "open" || (item.isBlocking && item.status === "read"));
  const recentlyOpenedItems = attention.filter((item) => item.status === "read" && !item.isBlocking);
  const runningSessions = sessions.filter((session) => session.isProcessing);
  const blockedSessions = sessions.filter((session) => deriveExecutionPhase(session) === "blocked");
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const project = activeSession ? projects.find((entry) => entry.id === activeSession.projectId) : null;
  const currentConversationId = activeSession?.conversationId ?? activeSession?.id;
  useEffect(() => {
    setSelectedCommentIds([]);
    setCommentLocation(null);
  }, [currentConversationId]);
  const comments = workflow.comments.filter((comment) =>
    comment.status !== "resolved" &&
    comment.status !== "dismissed" &&
    (!comment.conversationId || comment.conversationId === currentConversationId),
  );
  const selectedCurrentCommentIds = selectedCommentIds.filter((id) => comments.some((comment) => comment.id === id));

  useEffect(() => {
    workflow.handoffs.forEach((handoff) => {
      if (handoff.status !== "started" || !handoff.targetConversationId) return;
      const target = sessions.find((session) =>
        session.id === handoff.targetSessionId || session.conversationId === handoff.targetConversationId,
      );
      if (target?.isProcessing) handoffProcessingSeen.current.add(handoff.id);
      if (!target) return;
      const completed = target.hasUnreadCompletion ||
        (handoffProcessingSeen.current.has(handoff.id) && !target.isProcessing);
      const targetSessionId = handoff.targetSessionId ?? target.id;
      if (targetSessionId !== handoff.targetSessionId || completed) {
        workflowStore.saveHandoff({
          ...handoff,
          targetSessionId,
          status: completed ? "completed" : handoff.status,
          updatedAt: Date.now(),
        });
      }
    });
  }, [sessions, workflow.handoffs]);

  const markAttentionRead = (item: AttentionItem) => {
    setSelectedAttentionId(item.id);
    workflowStore.upsertAttention({ ...item, status: "read", updatedAt: Date.now() });
    onSelectSession(item.sessionId);
  };

  const openAttention = (item: AttentionItem) => {
    markAttentionRead(item);
    if (item.kind === "review") {
      setTab("review");
    } else if (item.kind === "handoff") {
      setTab("handoff");
    } else {
      onClose();
    }
  };

  const createReviewSnapshot = async (): Promise<ReviewSnapshot | null> => {
    if (!activeSession || !project) {
      toast.error("Open a project session before starting a review");
      return null;
    }
    const status = await window.claude.git.status(project.path);
    if ("error" in status) {
      toast.error("Could not read Git status", { description: status.error });
      return null;
    }
    const files = await Promise.all(status.files.map(async (file) => {
      const result = await window.claude.git.diffFile(project.path, file.path, file.group === "staged");
      if (result.diff) return { path: file.path, group: file.group, diff: result.diff };
      if (file.group === "untracked") {
        const [read] = await window.claude.files.readMultiple(project.path, [file.path]);
        if (read && "content" in read && typeof read.content === "string") {
          const contentLines = read.content.split("\n");
          return {
            path: file.path,
            group: file.group,
            diff: `@@ -0,0 +1,${contentLines.length} @@\n${contentLines.map((line) => `+${line}`).join("\n")}`,
          };
        }
      }
      return { path: file.path, group: file.group, diff: "(no diff available)" };
    }));
    const snapshot: ReviewSnapshot = {
      id: makeWorkflowId("review"),
      conversationId: activeSession.conversationId ?? activeSession.id,
      projectId: activeSession.projectId,
      cwd: project.path,
      scope: "working-tree",
      createdAt: Date.now(),
      files,
    };
    workflowStore.saveSnapshot(snapshot);
    return snapshot;
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    const snapshot = workflow.snapshots
      .filter((entry) => entry.conversationId === currentConversationId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const comment: ReviewComment = {
      id: makeWorkflowId("comment"),
      snapshotId: snapshot?.id ?? "unsnapshotted",
      conversationId: currentConversationId,
      filePath: commentLocation?.filePath ?? "conversation",
      group: commentLocation?.group,
      side: commentLocation?.side ?? "new",
      range: { start: commentLocation?.line ?? 0, end: commentLocation?.line ?? 0 },
      selectedText: commentLocation?.text ?? activeMessages.filter((message) => message.role === "assistant").at(-1)?.content.slice(0, 300) ?? "",
      body: commentText.trim(),
      category: "problem",
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    workflowStore.saveComment(comment);
    setSelectedCommentIds((ids) => [...ids, comment.id]);
    setCommentText("");
    setCommentLocation(null);
  };

  const buildHandoffPrompt = () => {
    if (!activeSession) return "";
    const chosen = comments.filter((comment) => selectedCurrentCommentIds.includes(comment.id));
    const selectedText = chosen.map((comment) => `- ${comment.filePath}${comment.group ? ` (${comment.group})` : ""}:${comment.side}:${comment.range.start} ${comment.body}`).join("\n");
    return [
      `You are receiving work from ${engineLabel(activeSession.engine)}.`,
      `Objective: ${purpose === "fix" ? "Fix the selected review findings." : purpose === "continue" ? "Continue the implementation from the current state." : "Review the current implementation and report actionable findings."}`,
      `Project: ${project?.path ?? "current project"}`,
      `Source session: ${activeSession.title}`,
      selectedText ? `Selected feedback:\n${selectedText}` : "No line comments were selected; inspect the current working tree.",
      "Preserve existing behavior, run relevant verification, and report what changed.",
    ].join("\n\n");
  };

  const sendHandoff = async () => {
    if (!activeSession) return;
    const chosen = comments.filter((comment) => selectedCurrentCommentIds.includes(comment.id));
    const prompt = buildHandoffPrompt();
    const handoffId = makeWorkflowId("handoff");
    const createdAt = Date.now();
    const handoffBase = {
      id: handoffId,
      sourceConversationId: activeSession.conversationId ?? activeSession.id,
      sourceSessionId: activeSession.id,
      projectId: activeSession.projectId,
      sourceEngine: activeSession.engine ?? "claude",
      targetEngine,
      purpose,
      objective: prompt,
      constraints: "Preserve existing behavior and keep the change scoped to this project.",
      verification: "Run relevant tests and report the exact commands and results.",
      commentIds: selectedCurrentCommentIds,
      snapshotId: currentSnapshot?.id,
      createdAt,
    };
    setIsSending(true);
    try {
      const handoffResult = onHandoff ? await onHandoff({ targetEngine, purpose, prompt }) : undefined;
      const now = Date.now();
      workflowStore.saveHandoff({
        ...handoffBase,
        targetConversationId: handoffResult?.targetConversationId,
        targetSessionId: handoffResult?.targetSessionId,
        status: handoffResult?.error ? "failed" : onHandoff ? "started" : "ready",
        error: handoffResult?.error,
        updatedAt: now,
      });
      if (!handoffResult?.error) {
        chosen.forEach((comment) => workflowStore.saveComment({ ...comment, status: "sent", updatedAt: now }));
      }
      if (handoffResult?.error) {
        toast.error("Handoff failed", { description: handoffResult.error });
      } else {
        toast.success(onHandoff ? `Handoff started in ${engineLabel(targetEngine)}` : "Handoff draft saved");
      }
      setTab("inbox");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      workflowStore.saveHandoff({ ...handoffBase, status: "failed", error: message, updatedAt: Date.now() });
      toast.error("Handoff failed", { description: message });
    } finally {
      setIsSending(false);
    }
  };

  const currentSnapshot = workflow.snapshots
    .filter((entry) => entry.conversationId === currentConversationId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Workflow center" className="absolute inset-0 z-40 flex min-w-0 flex-col bg-background/95 backdrop-blur-sm">
      <header className={`drag-region flex h-[3.25rem] shrink-0 items-center gap-3 border-b border-border/60 px-5 ${isMac ? "ps-[84px]" : ""}`}>
        <Inbox className="h-4 w-4 text-primary" />
        <div className="flex-1"><h1 className="text-sm font-semibold">Workflow center</h1><p className="text-[10px] text-muted-foreground">Attention, review, and handoff in one place</p></div>
        <Button variant="ghost" size="icon" className="no-drag" onClick={onClose} aria-label="Close workflow center"><X className="h-4 w-4" /></Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-e border-border/50 p-3">
          {(["inbox", "review", "handoff"] as const).map((item) => (
            <button key={item} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-xs ${tab === item ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setTab(item)}>
              {item === "inbox" ? <Inbox className="h-3.5 w-3.5" /> : item === "review" ? <GitPullRequest className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {item === "inbox" ? "Task inbox" : item === "review" ? "Review changes" : "Handoff"}
              {item === "inbox" && actionItems.length > 0 ? <Badge className="ms-auto px-1.5 text-[10px]">{actionItems.length}</Badge> : null}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {tab === "inbox" && (
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div><h2 className="text-lg font-semibold">Task inbox</h2><p className="text-xs text-muted-foreground">See what needs a decision before you scan the full execution log.</p></div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-700">{actionItems.length} to handle</span><span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{runningSessions.length} running</span></div>
              </div>

              {actionItems.length > 0 ? <section className="space-y-2" aria-labelledby="needs-action-heading"><div className="flex items-center gap-2"><ShieldAlert className="h-3.5 w-3.5 text-amber-600" /><h3 id="needs-action-heading" className="text-xs font-semibold uppercase tracking-wide text-foreground">Needs your action</h3><Badge variant="secondary" className="px-1.5 text-[10px]">{actionItems.length}</Badge></div><div className="space-y-2">{actionItems.map((item) => {
                const session = sessions.find((entry) => entry.id === item.sessionId);
                const phase = item.phase ?? (session ? deriveExecutionPhase(session) : "idle");
                return <button key={item.id} onClick={() => openAttention(item)} aria-label={`${item.title}: ${item.actionLabel ?? "Open session"}`} className={`flex w-full items-center gap-3 rounded-lg border p-4 text-start transition-colors hover:bg-muted/50 ${selectedAttentionId === item.id ? "border-primary/50 bg-primary/5" : "border-border/60"}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/70"><PhaseIcon phase={phase} /></span>
                  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium"><span>{item.title}</span><Badge variant={item.priority === "critical" ? "destructive" : "outline"} className="text-[10px]">{priorityLabel(item.priority)}</Badge><Badge variant="outline" className="text-[10px]">{engineLabel(session?.engine)}</Badge></span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span><span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{phaseLabel(phase)}</span>{session ? <span>· {session.title}</span> : null}</span></span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary">{item.actionLabel ?? "Open session"}<ChevronRight className="h-4 w-4" /></span>
                </button>;
              })}</div></section> : null}

              {runningSessions.length > 0 ? <section className="space-y-2" aria-labelledby="running-heading"><div className="flex items-center gap-2"><LoaderCircle className="h-3.5 w-3.5 text-primary" /><h3 id="running-heading" className="text-xs font-semibold uppercase tracking-wide text-foreground">Running now</h3><Badge variant="secondary" className="px-1.5 text-[10px]">{runningSessions.length}</Badge></div><div className="grid gap-2 sm:grid-cols-2">{runningSessions.map((session) => {
                const phase = deriveExecutionPhase(session);
                const projectName = projects.find((entry) => entry.id === session.projectId)?.name;
                return <button key={session.id} onClick={() => onSelectSession(session.id)} className="flex min-w-0 items-start gap-3 rounded-lg border border-border/60 p-3 text-start transition-colors hover:bg-muted/50"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"><PhaseIcon phase={phase} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-xs font-medium"><span className="truncate">{session.title}</span><Badge variant="outline" className="shrink-0 text-[10px]">{engineLabel(session.engine)}</Badge></span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{projectName ?? "Current project"} · {phaseLabel(phase)}</span></span><ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" /></button>;
              })}</div></section> : null}

              {blockedSessions.length > 0 && actionItems.length === 0 ? <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" />{blockedSessions.length} session(s) are blocked. Open the session to resolve the blocker.</div> : null}

              {recentlyOpenedItems.length > 0 ? <section className="space-y-2" aria-labelledby="recent-heading"><div className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" /><h3 id="recent-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recently opened</h3></div><div className="space-y-1">{recentlyOpenedItems.slice(0, 5).map((item) => <button key={item.id} onClick={() => openAttention(item)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-xs text-muted-foreground hover:bg-muted/50"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="shrink-0">Open again</span></button>)}</div></section> : null}

              {actionItems.length === 0 && runningSessions.length === 0 && recentlyOpenedItems.length === 0 ? <div className="rounded-lg border border-dashed border-border p-10 text-center"><CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-600" /><p className="text-sm font-medium">All clear</p><p className="mt-1 text-xs text-muted-foreground">No session is waiting for a decision or follow-up.</p></div> : null}
            </div>
          )}
          {tab === "review" && (
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Review changes</h2><p className="text-xs text-muted-foreground">Freeze the current working tree before giving feedback.</p></div><Button size="sm" onClick={() => void createReviewSnapshot()}><GitPullRequest className="me-2 h-3.5 w-3.5" />Capture snapshot</Button></div>
              {currentSnapshot ? <div className="space-y-3">{currentSnapshot.files.length === 0 ? <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">No Git changes in this snapshot.</div> : currentSnapshot.files.map((file) => <div key={`${file.group ?? "unknown"}:${file.path}`} className="overflow-hidden rounded-lg border border-border/60"><div className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-xs font-medium"><span className="flex-1">{file.path}</span><Badge variant="outline">{file.group ?? "snapshot"}</Badge></div><div className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed">{parseUnifiedDiff(file.diff).map((line, index) => <button key={`${index}-${line.text}`} type="button" disabled={!line.side} onClick={() => line.side && setCommentLocation({ filePath: file.path, group: file.group, line: line.side === "old" ? line.oldLine! : line.newLine!, side: line.side, text: line.text })} className={`block w-full px-1 text-start ${commentLocation?.filePath === file.path && commentLocation?.group === file.group && commentLocation.line === (line.side === "old" ? line.oldLine : line.newLine) ? "bg-primary/15" : line.side ? "hover:bg-muted/60" : "text-muted-foreground"}`}>{line.text || " "}</button>)}</div></div>)}</div> : <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Capture a snapshot to start a review.</div>}
              <div className="rounded-lg border border-border/60 p-4"><div className="mb-2 flex items-center gap-2 text-xs font-medium"><MessageSquare className="h-3.5 w-3.5" />Feedback drafts</div>{commentLocation ? <div className="mb-2 rounded bg-primary/10 px-2 py-1 text-[10px] text-primary">{commentLocation.filePath}{commentLocation.group ? ` (${commentLocation.group})` : ""}:{commentLocation.side}:{commentLocation.line}</div> : null}<textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Select a diff line, then add a review comment…" className="min-h-20 w-full resize-y rounded border border-border bg-background p-2 text-xs outline-none focus:border-primary" /><div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" onClick={() => void addComment()} disabled={!commentText.trim()}>Add feedback</Button></div>{comments.length > 0 ? <div className="mt-3 space-y-2">{comments.map((comment) => <label key={comment.id} className="flex gap-2 rounded bg-muted/40 p-2 text-xs"><input type="checkbox" checked={selectedCommentIds.includes(comment.id)} onChange={() => setSelectedCommentIds((ids) => ids.includes(comment.id) ? ids.filter((id) => id !== comment.id) : [...ids, comment.id])} /><span><span className="me-1 text-muted-foreground">{comment.filePath}{comment.group ? ` (${comment.group})` : ""}:{comment.side}:{comment.range.start}</span>{comment.body}</span></label>)}</div> : null}</div>
            </div>
          )}
          {tab === "handoff" && (
      <div className="mx-auto max-w-2xl space-y-5"><div><h2 className="text-lg font-semibold">Handoff work</h2><p className="text-xs text-muted-foreground">Send a reviewed, editable brief to another engine.</p></div><div className="space-y-4 rounded-lg border border-border/60 p-5"><label className="block text-xs font-medium">Target engine<select value={targetEngine} onChange={(event) => setTargetEngine(event.target.value as EngineId)} className="mt-1 block w-full rounded border border-border bg-background p-2 text-sm"><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label className="block text-xs font-medium">Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value as HandoffPurpose)} className="mt-1 block w-full rounded border border-border bg-background p-2 text-sm"><option value="review">Review current implementation</option><option value="fix">Fix selected findings</option><option value="continue">Continue implementation</option></select></label><div className="rounded bg-muted/40 p-3 text-xs text-muted-foreground">{activeSession ? `Source: ${activeSession.title} · ${engineLabel(activeSession.engine)}` : "Open a session first."}<br />{selectedCurrentCommentIds.length} feedback item(s) selected.</div><Button className="w-full" onClick={() => void sendHandoff()} disabled={!activeSession || isSending}>{isSending ? "Starting…" : <><Send className="me-2 h-3.5 w-3.5" />Create handoff</>}</Button><Button variant="ghost" className="w-full" onClick={() => { const prompt = buildHandoffPrompt(); if (!prompt) return; void navigator.clipboard?.writeText(prompt); toast.success("Handoff brief copied"); }}><Clipboard className="me-2 h-3.5 w-3.5" />Copy handoff brief</Button></div><div className="space-y-2"><h3 className="text-xs font-medium text-muted-foreground">Handoff history</h3>{workflow.handoffs.length === 0 ? <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">No handoffs yet.</div> : workflow.handoffs.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((handoff) => { const target = sessions.find((session) => session.id === handoff.targetSessionId || session.conversationId === handoff.targetConversationId); const status = handoff.status === "completed" ? "Completed" : handoff.status === "failed" ? "Failed" : handoff.status === "started" ? "In progress" : "Draft"; return <div key={handoff.id} className="rounded border border-border/60 p-3 text-xs"><div className="flex items-center gap-2"><span className="font-medium">{engineLabel(handoff.sourceEngine)} → {engineLabel(handoff.targetEngine)}</span><Badge variant={handoff.status === "failed" ? "destructive" : "outline"}>{status}</Badge>{target ? <Button variant="ghost" size="sm" className="ms-auto h-6 px-2 text-[11px]" onClick={() => onSelectSession(target.id)}>Open target</Button> : null}</div><p className="mt-1 line-clamp-2 text-muted-foreground">{handoff.objective}</p>{handoff.error ? <p className="mt-1 text-destructive">{handoff.error}</p> : null}</div>; })}</div></div>
          )}
        </main>
      </div>
    </div>
  );
}
