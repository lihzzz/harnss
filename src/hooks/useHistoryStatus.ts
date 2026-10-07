import { useCallback, useEffect, useState } from "react";
import type { HistoryIndexStatus } from "@shared/types/productivity";
import { reportError } from "@/lib/analytics/analytics";

export function useHistoryStatus() {
  const [status, setStatus] = useState<HistoryIndexStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const acceptStatus = useCallback((next: HistoryIndexStatus) => {
    setStatusError(null);
    setStatus((previous) => !previous || next.seq >= previous.seq ? next : previous);
  }, []);
  useEffect(() => {
    let active = true;
    const apply = (next: HistoryIndexStatus) => { if (active) acceptStatus(next); };
    const off = window.claude.history.onStatus(apply);
    window.claude.history.status().then((response) => {
      if (response.ok) apply(response.value); else if (active) setStatusError(response.error.message);
    }).catch((error: unknown) => { if (active) setStatusError(reportError("HISTORY:STATUS", error)); });
    return () => { active = false; off(); };
  }, [acceptStatus]);
  return { status, statusError, acceptStatus };
}
