import { describe, expect, it, vi } from "vitest";
import { createStreamTicker, STREAM_TICK_MIN_INTERVAL_MS } from "@/lib/audio/stream-tick";

function makeTicker(overrides: Partial<Parameters<typeof createStreamTicker>[0]> = {}) {
  const play = vi.fn();
  let now = 1000;
  const deps = {
    now: () => now,
    isHidden: () => false,
    isEnabled: () => true,
    play,
    ...overrides,
  };
  const tick = createStreamTicker(deps);
  return { tick, play, advance: (ms: number) => { now += ms; } };
}

describe("stream ticker", () => {
  it("plays on the first tick", () => {
    const { tick, play } = makeTicker();
    tick();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("throttles to one tick per interval", () => {
    const { tick, play, advance } = makeTicker();
    tick();
    tick();
    advance(STREAM_TICK_MIN_INTERVAL_MS - 1);
    tick();
    expect(play).toHaveBeenCalledTimes(1);
    advance(1);
    tick();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("stays silent when disabled", () => {
    const { tick, play } = makeTicker({ isEnabled: () => false });
    tick();
    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent when the window is hidden", () => {
    const { tick, play } = makeTicker({ isHidden: () => true });
    tick();
    expect(play).not.toHaveBeenCalled();
  });

  it("caps ticks per second under rapid streaming", () => {
    const { tick, play, advance } = makeTicker();
    // Simulate 1 second of deltas at 60fps (16.7ms apart)
    for (let i = 0; i < 60; i++) {
      tick();
      advance(16.7);
    }
    expect(play.mock.calls.length).toBeLessThanOrEqual(12);
    expect(play.mock.calls.length).toBeGreaterThan(5);
  });
});
