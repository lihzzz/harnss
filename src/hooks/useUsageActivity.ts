import { useEffect } from "react";
import { USAGE_SAMPLE_MS } from "@shared/lib/usage";
import type { UsageInterval } from "@shared/types/usage";
import { UsageActivity } from "@/lib/analytics/usage-activity";

export function useUsageActivity(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const activity = new UsageActivity();
    const send = (interval: UsageInterval | null) => {
      if (interval) window.claude.usage.activity(...interval);
    };
    const pause = () => send(activity.pause(Date.now()));
    const onInteraction = (event: Event) => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (event.target instanceof Element && event.target.closest("[data-usage-chat]")) send(activity.interact(Date.now()));
      else pause();
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") pause(); };
    const options = { capture: true, passive: true };
    for (const event of ["pointerdown", "keydown", "wheel"]) document.addEventListener(event, onInteraction, options);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) send(activity.sample(Date.now()));
      else pause();
    }, USAGE_SAMPLE_MS);
    return () => {
      pause();
      window.clearInterval(timer);
      for (const event of ["pointerdown", "keydown", "wheel"]) document.removeEventListener(event, onInteraction, options);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
