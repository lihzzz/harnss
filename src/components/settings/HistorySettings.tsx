import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsHeader, SettingsSection } from "./shared";
import { useHistoryStatus } from "@/hooks/useHistoryStatus";
import { useI18n } from "@/lib/i18n";
import { reportError } from "@/lib/analytics/analytics";
import { HISTORY_EMBEDDING_MODEL } from "@shared/lib/embedding-model";
import type { AppSettings } from "@shared/types/settings";
import type { HistoryIndexStatus, OperationResult } from "@shared/types/productivity";

export function HistorySettings({ appSettings, onUpdateAppSettings }: {
  appSettings: AppSettings | null; onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useI18n();
  const { status, statusError, acceptStatus } = useHistoryStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = appSettings?.history.semanticEnabled ?? false;
  const run = async (task: () => Promise<OperationResult<HistoryIndexStatus> | void>) => {
    setBusy(true); setError(null);
    try { const result = await task(); if (result) { if (result.ok) acceptStatus(result.value); else setError(result.error.message); } }
    catch (reason) { setError(reportError("HISTORY:SETTINGS", reason)); }
    finally { setBusy(false); }
  };
  const progress = status?.semanticProgress;
  const preparing = status?.semanticState === "preparing" || status?.semanticState === "indexing";
  return <div className="flex h-full flex-col">
    <SettingsHeader title={t("Conversation history")} description={t("Search saved conversations across projects and spaces.")} />
    <ScrollArea className="min-h-0 flex-1"><div className="px-6 py-2">
      <SettingsSection icon={Search} label={t("Local semantic search")} first>
        <SettingRow label={t("Enable semantic search")} description={t("Downloads a multilingual model. Conversation text stays on this device.")}>
          <input type="checkbox" aria-label={t("Enable semantic search")} checked={enabled} disabled={busy || !appSettings}
            onChange={(event) => { const semanticEnabled = event.target.checked; void run(() => onUpdateAppSettings({ history: { semanticEnabled, embeddingModelKey: HISTORY_EMBEDDING_MODEL.key } })); }} />
        </SettingRow>
        <div className="space-y-3 py-4 text-xs text-muted-foreground">
          <p role="status">{t("History coverage")}: {status?.coverage.indexed ?? 0} / {status?.coverage.discovered ?? 0}
            {status && !status.coverage.keywordComplete ? ` · ${t("Incomplete")}` : ""}</p>
          <p role="status">{t("Semantic messages indexed")}: {progress?.indexedEntries ?? 0} / {progress?.totalEntries ?? 0} · {t("Failed")}: {progress?.failedEntries ?? 0}
            {enabled ? ` · ${t(status?.semanticState === "paused" ? "Indexing paused" : status?.semanticState === "ready" ? "Semantic search ready" : preparing ? "Indexing…" : "Indexing needs attention")}` : ` · ${t("Disabled")}`}</p>
          {progress?.download && <div role="status"><span>{t("Downloading local model")}</span>
            <progress className="ml-2 w-36" aria-label={t("Downloading local model")} value={progress.download.total ? progress.download.loaded : undefined} max={progress.download.total ?? 1} />
          </div>}
          {(error || statusError || progress?.error) && <p role="alert" className="text-destructive">{error ?? statusError ?? progress?.error?.message}</p>}
          <div className="flex flex-wrap gap-2">
            {enabled && status?.semanticState !== "ready" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void run(() => window.claude.history.semanticControl(preparing ? "pause" : "resume")); }}>{t(preparing ? "Pause semantic indexing" : "Resume semantic indexing")}</Button>}
            <Button size="sm" variant="outline" disabled={busy || status?.state === "indexing"} onClick={() => { void run(() => status?.state === "rebuilding" ? window.claude.history.cancelRebuild() : window.claude.history.rebuild(enabled ? "all" : "keyword")); }}>{t(status?.state === "rebuilding" ? "Cancel rebuild" : "Rebuild search index")}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void run(() => window.claude.history.semanticControl("clear")); }}>{t("Clear semantic cache")}</Button>
          </div>
          <p>{t("Clearing semantic cache disables semantic search and removes its downloaded model and vectors. Saved conversations and keyword search are kept.")}</p>
        </div>
      </SettingsSection>
    </div></ScrollArea>
  </div>;
}
