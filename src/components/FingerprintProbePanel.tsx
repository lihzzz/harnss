import { memo, useEffect, useMemo, useState } from "react";
import { Fingerprint, Loader2, Play, ShieldCheck, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelHeader } from "@/components/PanelHeader";
import type { CodexFingerprintProbeResult, CodexFingerprintVerdict } from "@/types";
import type { CodexModel } from "@shared/types/codex";

interface FingerprintProbePanelProps {
  headerControls?: React.ReactNode;
}

const verdictStyles: Record<CodexFingerprintVerdict["verdict"], string> = {
  MATCH: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  SUSPICIOUS: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  MISMATCH: "bg-red-500/10 text-red-600 dark:text-red-300",
  UNLISTED: "bg-foreground/[0.06] text-muted-foreground",
  INVALID: "bg-foreground/[0.06] text-muted-foreground",
  UNKNOWN: "bg-foreground/[0.06] text-muted-foreground",
};

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export const FingerprintProbePanel = memo(function FingerprintProbePanel({
  headerControls,
}: FingerprintProbePanelProps) {
  const [models, setModels] = useState<CodexModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedEffort, setSelectedEffort] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodexFingerprintProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    window.claude.codex.listModels()
      .then((response) => {
        if (cancelled) return;
        if (response.error) {
          setModelsError(response.error);
          setModels([]);
        } else {
          setModelsError(null);
          setModels(response.models ?? []);
          setSelectedModel((current) =>
            current || (response.models.find((model) => model.isDefault)?.id ?? response.models[0]?.id ?? ""),
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setModelsError(error instanceof Error ? error.message : "Unable to load Codex models");
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentModel = models.find((model) => model.id === selectedModel);
  const effortOptions = currentModel?.supportedReasoningEfforts ?? [];
  const activeEffort = effortOptions.find((option) => option.reasoningEffort === selectedEffort)?.reasoningEffort
    ?? effortOptions.find((option) => option.reasoningEffort === currentModel?.defaultReasoningEffort)?.reasoningEffort
    ?? effortOptions[0]?.reasoningEffort;

  const runProbe = async () => {
    if (!selectedModel || running) return;
    setRunning(true);
    setProbeError(null);
    setResult(null);
    try {
      const response = await window.claude.codex.fingerprintProbe({ model: selectedModel, effort: activeEffort });
      if ("error" in response && response.error) {
        setProbeError(response.error);
      } else if ("error" in response) {
        setProbeError("Fingerprint probe failed");
      } else {
        setResult(response);
      }
    } catch (error: unknown) {
      setProbeError(error instanceof Error ? error.message : "Fingerprint probe failed");
    } finally {
      setRunning(false);
    }
  };

  const topCandidates = useMemo(() => result?.analysis?.results ?? [], [result]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={Fingerprint} label="Fingerprint Probe" iconClass="text-fuchsia-600/70 dark:text-fuchsia-200/50">
        {headerControls}
      </PanelHeader>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-3">
          <div className="space-y-2 rounded-lg border border-border/50 bg-background/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Target model</span>
              {result && (
                <Badge variant="secondary" className={verdictStyles[result.verdict.verdict]}>
                  {result.verdict.verdict}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select value={selectedModel} onValueChange={setSelectedModel} disabled={modelsLoading || running}>
                  <SelectTrigger size="sm" className="w-full text-foreground/80">
                    <SelectValue placeholder={modelsLoading ? "Loading models…" : "Select model"} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.displayName || model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => void runProbe()} disabled={!selectedModel || running || modelsLoading}>
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run
              </Button>
            </div>
            {effortOptions.length > 0 && (
              <div className="space-y-2">
                <span className="text-[11px] font-medium text-muted-foreground">Reasoning effort</span>
                <Select value={activeEffort} onValueChange={setSelectedEffort} disabled={modelsLoading || running}>
                  <SelectTrigger size="sm" className="w-full capitalize text-foreground/80" aria-label="Reasoning effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {effortOptions.map((option) => (
                      <SelectItem key={option.reasoningEffort} value={option.reasoningEffort} className="capitalize">
                        {option.reasoningEffort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-muted-foreground/50">
              Runs three fresh, ephemeral Codex turns and compares their random-number fingerprint with a local
              ModelTrace bank. This uses three short model responses from your Codex account.
            </p>
            {modelsError && <p className="text-[10px] text-red-500">{modelsError}</p>}
            {probeError && <p className="text-[10px] leading-relaxed text-red-500">{probeError}</p>}
          </div>

          {result?.analysis && (
            <div className="space-y-3 rounded-lg border border-border/50 bg-background/70 p-3">
              <div className="flex items-start gap-2">
                {result.verdict.verdict === "MATCH" ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-500" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-semibold text-foreground">{result.verdict.message}</p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Selected <span className="font-mono">{result.selectedModel}</span>; fingerprint{" "}
                    <span className="font-mono">{result.analysis.prediction}</span> ·{" "}
                    {formatPercent(result.analysis.probability)} · {result.analysis.usedOutputs} valid samples ·{" "}
                    {result.verdict.direction ? `${result.verdict.direction} · ` : ""}
                    {(result.elapsedMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Candidate probabilities
                </p>
                <div className="space-y-1">
                  {topCandidates.map((candidate) => (
                    <div key={candidate.model} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px] text-foreground/70">{candidate.model}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatPercent(candidate.probability)}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                        <div
                          className="h-full rounded-full bg-foreground/35"
                          style={{ width: `${Math.max(1, candidate.probability * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-1 text-[10px] text-muted-foreground">
                {result.reasoningEffort && <span>Reasoning effort: {result.reasoningEffort}</span>}
                <span>
                  Selected-model probability: {formatPercent(result.verdict.selectedModelProbability)}
                </span>
                <span>Score margin: {result.verdict.margin == null ? "—" : result.verdict.margin.toFixed(2)}</span>
                <span>
                  Calibration: n={result.analysis.calibration.queries}, β={result.analysis.calibration.beta.toFixed(2)},
                  CV accuracy={formatPercent(result.analysis.calibration.cvAccuracy)}
                </span>
                <span>Method: {result.analysis.method}</span>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Samples
              </p>
              {result.samples.map((sample) => (
                <div key={sample.sampleId} className="space-y-1 rounded-lg border border-border/50 bg-background/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-foreground/70">Sample {sample.sampleId + 1}</span>
                    <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[9px] tabular-nums">
                      {sample.parsedCount}/{sample.requestedCount}
                    </Badge>
                  </div>
                  <p className="break-all text-[10px] leading-relaxed text-muted-foreground/60">
                    Prompt: {sample.prompt}
                  </p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-foreground/[0.03] p-2 font-mono text-[10px] leading-relaxed text-foreground/75">
                    {sample.response || "(empty response)"}
                  </pre>
                  {sample.error && <p className="text-[10px] text-red-500">{sample.error}</p>}
                  <p className="text-[10px] text-muted-foreground/50">
                    {sample.accepted ? "Accepted" : "Rejected"} · parsed {sample.parsedCount}, minimum{" "}
                    {Math.max(80, Math.ceil(sample.requestedCount * 0.55))}
                  </p>
                </div>
              ))}
            </div>
          )}

          {!result && !running && !probeError && !modelsError && (
            <p className="px-1 py-2 text-[10px] leading-relaxed text-muted-foreground/40">
              Run a probe to verify whether the selected model is actually the one answering.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
