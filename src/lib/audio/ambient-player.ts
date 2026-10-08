/**
 * Procedural ambient sound player (WebAudio).
 *
 * All sounds are generated — no audio assets. White/pink noise are looped
 * AudioBuffers; rain is filtered pink noise with a slow LFO on the filter
 * frequency. The player is a singleton driven by useAmbientSound; settings
 * live in the zustand settings store.
 */

export type AmbientSoundMode = "off" | "white" | "pink" | "rain";

const BUFFER_SECONDS = 2;
const RAIN_FILTER_HZ = 900;
const RAIN_LFO_HZ = 0.13;
const RAIN_LFO_DEPTH_HZ = 420;

function makeWhiteNoise(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * BUFFER_SECONDS;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Paul Kellet-style pink noise approximation. */
function makePinkNoise(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * BUFFER_SECONDS;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

export interface AmbientPlayer {
  readonly isPlaying: boolean;
  readonly currentMode: AmbientSoundMode;
  start: (mode: Exclude<AmbientSoundMode, "off">, volume: number) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
}

export function createAmbientPlayer(): AmbientPlayer {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  let playing = false;
  let mode: AmbientSoundMode = "off";
  let volume = 0.3;

  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  }

  function teardownNodes(): void {
    try { source?.stop(); } catch { /* already stopped */ }
    source?.disconnect();
    try { lfo?.stop(); } catch { /* already stopped */ }
    lfo?.disconnect();
    lfoGain?.disconnect();
    source = null;
    lfo = null;
    lfoGain = null;
  }

  return {
    get isPlaying() { return playing; },
    get currentMode() { return mode; },

    start(nextMode, nextVolume) {
      const audioCtx = ensureContext();
      teardownNodes();
      volume = clampVolume(nextVolume);
      mode = nextMode;

      if (!gain) {
        gain = audioCtx.createGain();
        gain.connect(audioCtx.destination);
      }
      gain.gain.value = volume;

      const buffer = nextMode === "white" ? makeWhiteNoise(audioCtx) : makePinkNoise(audioCtx);
      source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      if (nextMode === "rain") {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = RAIN_FILTER_HZ;
        lfo = audioCtx.createOscillator();
        lfo.frequency.value = RAIN_LFO_HZ;
        lfoGain = audioCtx.createGain();
        lfoGain.gain.value = RAIN_LFO_DEPTH_HZ;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
        source.connect(filter);
        filter.connect(gain);
        lfo.start();
      } else {
        source.connect(gain);
      }

      source.start();
      playing = true;
    },

    stop() {
      teardownNodes();
      playing = false;
      mode = "off";
    },

    setVolume(nextVolume) {
      volume = clampVolume(nextVolume);
      if (gain && ctx) {
        gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
      }
    },
  };
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return Math.min(1, Math.max(0, value));
}

export const ambientPlayer = createAmbientPlayer();
