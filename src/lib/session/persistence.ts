import { toast } from "sonner";
import type { PersistedSession } from "@/types";
import { reportError } from "@/lib/analytics/analytics";

/** Save the new runtime's history before retiring its previous on-disk snapshot. */
export async function persistSessionReplacement(previousSessionId: string, data: PersistedSession): Promise<void> {
  try {
    const result = await window.claude.sessions.save(data, previousSessionId);
    if (result.error) throw new Error(result.error);
  } catch (error) {
    const message = reportError("SESSIONS:REPLACE_ERR", error, { sessionId: data.id });
    toast.error(`Failed to update saved session: ${message}`);
  }
}
