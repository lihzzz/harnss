/**
 * Soft tick sound played while the active session streams output.
 * Opt-in (streamTickEnabled setting), throttled to one tick per 90ms,
 * silent when the window is hidden.
 */

import { useSettingsStore } from "@/stores/settings-store";

export const STREAM_TICK_MIN_INTERVAL_MS = 90;
const TICK_FREQUENCY_HZ = 1250;
const TICK_DURATION_S = 0.025;
const TICK_GAIN = 0.015;

export interface StreamTickerDeps {
  now: () => number;
  isHidden: () => boolean;
  isEnabled: () => boolean;
  play: () => void;
}

export function createStreamTicker(deps: StreamTickerDeps): () => void {
  let lastTickAt = Number.NEGATIVE_INFINITY;
  return function tick(): void {
    if (!deps.isEnabled() || deps.isHidden()) return;
    const now = deps.now();
    if (now - lastTickAt < STREAM_TICK_MIN_INTERVAL_MS) return;
    lastTickAt = now;
    deps.play();
  };
}

// ── WebAudio tick sound (lazy context, created on first enabled tick) ──

let tickCtx: AudioContext | null = null;

function playTickSound(): void {
  if (!tickCtx) {
    tickCtx = new AudioContext();
  }
  if (tickCtx.state === "suspended") {
    void tickCtx.resume();
  }
  const osc = tickCtx.createOscillator();
  const gain = tickCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = TICK_FREQUENCY_HZ;
  const t = tickCtx.currentTime;
  gain.gain.setValueAtTime(TICK_GAIN, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + TICK_DURATION_S);
  osc.connect(gain);
  gain.connect(tickCtx.destination);
  osc.start(t);
  osc.stop(t + TICK_DURATION_S);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

export const streamTick = createStreamTicker({
  now: () => performance.now(),
  isHidden: () => document.hidden,
  isEnabled: () => useSettingsStore.getState().streamTickEnabled,
  play: playTickSound,
});
