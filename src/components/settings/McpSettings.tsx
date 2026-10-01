import { Plug, PanelRight, FolderOpen, Activity } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function McpSettings() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
          <Plug className="h-7 w-7 text-foreground/80" />
        </div>
        <h2 className="mt-1 text-xl font-semibold text-foreground">{t("mcpServers")}</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          {t("settingsMcpToolbarDescription")}{" "}
          <Plug className="inline h-3.5 w-3.5 -translate-y-px text-foreground/70" />{" "}
          <span className="font-medium text-foreground">{t("mcpServers")}</span>{" "}
          {t("settingsMcpToolbarSuffix")}
        </p>

        <div className="mt-4 w-full space-y-3 rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t("settingsMcpWhyToolbar")}
          </h3>
          <div className="flex gap-3">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("settingsMcpPerProject")}</span>{" "}
              &mdash; {t("settingsMcpPerProjectDescription")}
            </p>
          </div>
          <div className="flex gap-3">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("settingsMcpLiveStatus")}</span>{" "}
              &mdash; {t("settingsMcpLiveStatusDescription")}
            </p>
          </div>
          <div className="flex gap-3">
            <PanelRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("settingsMcpAlwaysAccessible")}</span>{" "}
              &mdash; {t("settingsMcpAlwaysAccessibleDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
