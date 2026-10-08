/**
 * Drives the ambient sound player from the settings store.
 * Mount once at app level (useAppOrchestrator).
 */

import { useEffect } from "react";
import { ambientPlayer } from "@/lib/audio/ambient-player";
import { useSettingsStore } from "@/stores/settings-store";

export function useAmbientSound(): void {
  const ambientSound = useSettingsStore((s) => s.ambientSound);
  const ambientVolume = useSettingsStore((s) => s.ambientVolume);

  useEffect(() => {
    if (ambientSound === "off") {
      ambientPlayer.stop();
      return;
    }
    ambientPlayer.start(ambientSound, ambientVolume);
  }, [ambientSound, ambientVolume]);

  // Stop on unmount (e.g. window teardown)
  useEffect(() => () => ambientPlayer.stop(), []);
}
