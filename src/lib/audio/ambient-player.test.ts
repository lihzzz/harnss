import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAmbientPlayer, type AmbientSoundMode } from "@/lib/audio/ambient-player";

// ── Minimal WebAudio mocks ──

function makeParam() {
  return { value: 0, setTargetAtTime: vi.fn() };
}

function makeNode(extra: Record<string, unknown> = {}) {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...extra,
  };
}

function makeMockContext() {
  const buffer = { getChannelData: () => new Float32Array(16) };
  return {
    state: "running",
    currentTime: 0,
    sampleRate: 8,
    destination: makeNode(),
    resume: vi.fn(),
    createGain: vi.fn(() => makeNode({ gain: makeParam() })),
    createBuffer: vi.fn(() => buffer),
    createBufferSource: vi.fn(() => makeNode({ start: vi.fn(), stop: vi.fn(), loop: false, buffer: null })),
    createBiquadFilter: vi.fn(() => makeNode({ type: "", frequency: makeParam() })),
    createOscillator: vi.fn(() => makeNode({ start: vi.fn(), stop: vi.fn(), frequency: makeParam() })),
  };
}

let mockCtx: ReturnType<typeof makeMockContext>;

beforeEach(() => {
  mockCtx = makeMockContext();
  // A plain function works as a constructor: `new AudioContext()` returns mockCtx.
  vi.stubGlobal("AudioContext", function () { return mockCtx; });
});

describe("ambient player state machine", () => {
  it("starts in a stopped state", () => {
    const player = createAmbientPlayer();
    expect(player.isPlaying).toBe(false);
    expect(player.currentMode).toBe("off");
  });

  it("starts playback for each non-off mode", () => {
    const player = createAmbientPlayer();
    const modes: Array<Exclude<AmbientSoundMode, "off">> = ["white", "pink", "rain"];
    for (const mode of modes) {
      player.start(mode, 0.5);
      expect(player.isPlaying).toBe(true);
      expect(player.currentMode).toBe(mode);
    }
  });

  it("rain mode wires a lowpass filter and LFO", () => {
    const player = createAmbientPlayer();
    player.start("rain", 0.5);
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
  });

  it("white/pink modes skip the filter chain", () => {
    const player = createAmbientPlayer();
    player.start("white", 0.5);
    expect(mockCtx.createBiquadFilter).not.toHaveBeenCalled();
    player.start("pink", 0.5);
    expect(mockCtx.createBiquadFilter).not.toHaveBeenCalled();
  });

  it("stop returns to off state", () => {
    const player = createAmbientPlayer();
    player.start("white", 0.5);
    player.stop();
    expect(player.isPlaying).toBe(false);
    expect(player.currentMode).toBe("off");
  });

  it("restarting tears down the previous source", () => {
    const player = createAmbientPlayer();
    player.start("white", 0.5);
    const firstSource = mockCtx.createBufferSource.mock.results[0].value;
    player.start("pink", 0.5);
    expect(firstSource.stop).toHaveBeenCalledTimes(1);
    expect(firstSource.disconnect).toHaveBeenCalled();
  });

  it("clamps volume into 0-1", () => {
    const player = createAmbientPlayer();
    player.start("white", 2);
    const gain = mockCtx.createGain.mock.results[0].value;
    expect(gain.gain.value).toBe(1);
    player.setVolume(-1);
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.05);
    player.setVolume(Number.NaN);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 0, 0.05);
  });
});
