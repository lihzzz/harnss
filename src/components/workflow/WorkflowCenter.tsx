import { useEffect, useMemo, useSyncExternalStore, useState } from "react";
import { ChevronRight, Clipboard, GitPullRequest, Inbox, MessageSquare, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import type { AttentionItem, ChatSession, EngineId, HandoffPurpose, Project, ReviewComment, ReviewSnapshot } from "@/types";
import { deriveAttentionItems } from "@/lib/workflow/attention";
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
  onHandoff?: (input: { targetEngine: EngineId; purpose: HandoffPurpose; prompt: string }) => Promise<{ targetConversationId?: string }>;
}

function engineLabel(engine?: EngineId): string {
  return engine === "claude" ? "Claude" : engine === "codex" ? "Codex" : "ACP";
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
  const workflow = useWorkflowState();
  const derivedAttention = deriveAttentionItems(sessions);
  const attention = useMemo(() => {
    const manualById = new Map(workflow.attention.map((item) => [item.id, item]));
    const merged = derivedAttention.map((item) => {
      const persisted = manualById.get(item.id);
      return persisted
        ? { ...item, status: persisted.status, updatedAt: persisted.updatedAt }
        : item;
    });
    const derivedIds = new Set(derivedAttention.map((item) => item.id));
    const manual = workflow.attention.filter((item) => !derivedIds.has(item.id));
    return [...merged, ...manual].filter((item) => item.status !== "dismissed" && item.status !== "resolved");
  }, [derivedAttention, workflow.attention]);
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

  const markAttentionRead = (item: AttentionItem) => {
    setSelectedAttentionId(item.id);
    workflowStore.upsertAttention({ ...item, status: "read", updatedAt: Date.now() });
    onSelectSession(item.sessionId);
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
    setIsSending(true);
    try {
      const handoffResult = onHandoff ? await onHandoff({ targetEngine, purpose, prompt }) : undefined;
      const now = Date.now();
      workflowStore.saveHandoff({
        id: makeWorkflowId("handoff"),
        sourceConversationId: activeSession.conversationId ?? activeSession.id,
        sourceSessionId: activeSession.id,
        projectId: activeSession.projectId,
        sourceEngine: activeSession.engine ?? "claude",
        targetEngine,
        targetConversationId: handoffResult?.targetConversationId,
        purpose,
        objective: prompt,
        constraints: "Preserve existing behavior and keep the change scoped to this project.",
        verification: "Run relevant tests and report the exact commands and results.",
        commentIds: selectedCurrentCommentIds,
        snapshotId: currentSnapshot?.id,
        status: onHandoff ? "started" : "ready",
        createdAt: now,
        updatedAt: now,
      });
      chosen.forEach((comment) => workflowStore.saveComment({ ...comment, status: "sent", updatedAt: now }));
      toast.success(onHandoff ? `Handoff started in ${engineLabel(targetEngine)}` : "Handoff draft saved");
      setTab("inbox");
    } catch (error) {
      toast.error("Handoff failed", { description: error instanceof Error ? error.message : String(error) });
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
              {item === "inbox" && attention.length > 0 ? <Badge className="ms-auto px-1.5 text-[10px]">{attention.length}</Badge> : null}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {tab === "inbox" && (
            <div className="mx-auto max-w-3xl space-y-3">
              <div className="mb-5"><h2 className="text-lg font-semibold">Task inbox</h2><p className="text-xs text-muted-foreground">Sessions that need a decision, a review, or a follow-up.</p></div>
              {attention.length === 0 ? <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No tasks need your attention.</div> : attention.map((item) => {
                const session = sessions.find((entry) => entry.id === item.sessionId);
                return <button key={item.id} onClick={() => markAttentionRead(item)} className={`flex w-full items-center gap-3 rounded-lg border p-4 text-start transition-colors hover:bg-muted/50 ${selectedAttentionId === item.id ? "border-primary/50 bg-primary/5" : "border-border/60"}`}>
                  <span className={`h-2 w-2 rounded-full ${item.kind === "error" ? "bg-destructive" : item.kind === "permission" ? "bg-amber-500" : "bg-primary"}`} />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium">{item.title}<Badge variant="outline" className="text-[10px]">{engineLabel(session?.engine)}</Badge></span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span></span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>;
              })}
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
      <div className="mx-auto max-w-2xl space-y-5"><div><h2 className="text-lg font-semibold">Handoff work</h2><p className="text-xs text-muted-foreground">Send a reviewed, editable brief to another engine.</p></div><div className="space-y-4 rounded-lg border border-border/60 p-5"><label className="block text-xs font-medium">Target engine<select value={targetEngine} onChange={(event) => setTargetEngine(event.target.value as EngineId)} className="mt-1 block w-full rounded border border-border bg-background p-2 text-sm"><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label className="block text-xs font-medium">Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value as HandoffPurpose)} className="mt-1 block w-full rounded border border-border bg-background p-2 text-sm"><option value="review">Review current implementation</option><option value="fix">Fix selected findings</option><option value="continue">Continue implementation</option></select></label><div className="rounded bg-muted/40 p-3 text-xs text-muted-foreground">{activeSession ? `Source: ${activeSession.title} · ${engineLabel(activeSession.engine)}` : "Open a session first."}<br />{selectedCurrentCommentIds.length} feedback item(s) selected.</div><Button className="w-full" onClick={() => void sendHandoff()} disabled={!activeSession || isSending}>{isSending ? "Starting…" : <><Send className="me-2 h-3.5 w-3.5" />Create handoff</>}</Button><Button variant="ghost" className="w-full" onClick={() => { const prompt = buildHandoffPrompt(); if (!prompt) return; void navigator.clipboard?.writeText(prompt); toast.success("Handoff brief copied"); }}><Clipboard className="me-2 h-3.5 w-3.5" />Copy handoff brief</Button></div></div>
          )}
        </main>
      </div>
    </div>
  );
}
