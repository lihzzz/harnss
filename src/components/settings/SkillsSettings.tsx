import { memo, useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw, FolderOpen, FolderSearch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { SkillInfo, SkillSource, SkillsListResult } from "@shared/types/skills";

const SOURCE_ORDER: SkillSource[] = ["claude", "codex", "agents"];
const SOURCE_LABEL_KEYS: Record<SkillSource, TranslationKey> = {
  claude: "skillsSourceClaude",
  codex: "skillsSourceCodex",
  agents: "skillsSourceAgents",
};

const SkillRow = memo(function SkillRow({ skill }: { skill: SkillInfo }) {
  const { t } = useI18n();
  return (
    <div className="group flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
        <Sparkles className="h-4 w-4 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100"
            onClick={() => window.claude.showItemInFolder(skill.path)}
            aria-label={t("skillsRevealInFolder")}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{t("skillsRevealInFolder")}</TooltipContent>
      </Tooltip>
    </div>
  );
});

export const SkillsSettings = memo(function SkillsSettings() {
  const { t } = useI18n();
  const [result, setResult] = useState<SkillsListResult | null>(null);

  const refresh = useCallback(() => {
    window.claude.skills.list().then(setResult).catch(() => setResult({ skills: [], sources: [] }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between pe-4">
        <SettingsHeader title={t("skills")} description={t("skillsDescription")} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="mt-4 rounded-md p-1.5 text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={refresh}
              aria-label={t("skillsRefresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("skillsRefresh")}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {SOURCE_ORDER.map((source, index) => {
            const skills = result?.skills.filter((s) => s.source === source) ?? [];
            const sourceStatus = result?.sources.find((s) => s.source === source);
            return (
              <SettingsSection
                key={source}
                label={`${t(SOURCE_LABEL_KEYS[source])}${result ? ` (${skills.length})` : ""}`}
                first={index === 0}
              >
                {skills.length > 0 ? (
                  <div className="divide-y divide-foreground/[0.04]">
                    {skills.map((skill) => (
                      <SkillRow key={skill.path} skill={skill} />
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-xs text-muted-foreground/70">
                    {result && !sourceStatus?.exists ? t("skillsDirectoryMissing") : t("skillsEmpty")}
                  </p>
                )}
              </SettingsSection>
            );
          })}

          {result && result.skills.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FolderSearch className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground/80">{t("skillsEmpty")}</p>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                {t("skillsEmptyDescription")}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
