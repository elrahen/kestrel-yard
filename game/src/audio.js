// Procedural sound: every effect is synthesised with WebAudio, so the game
// ships no audio files and makes no network request. One shared context,
// created on the first user gesture.

let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
}

function noiseBuffer(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', sweepTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

function tone({ freq = 440, dur = 0.08, gain = 0.2, type = 'square', slideTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  shot(kind) {
    if (kind === 'dmr') { burst({ dur: 0.28, freq: 900, gain: 0.8, sweepTo: 120 }); tone({ freq: 140, dur: 0.16, gain: 0.4, type: 'sine', slideTo: 55 }); }
    else if (kind === 'shotgun') { burst({ dur: 0.22, freq: 1400, gain: 0.8, sweepTo: 200 }); }
    else if (kind === 'pistol') { burst({ dur: 0.09, freq: 2400, gain: 0.45, sweepTo: 500 }); }
    else { burst({ dur: 0.11, freq: 2000, gain: 0.55, sweepTo: 300 }); }
  },
  distantShot() { burst({ dur: 0.1, freq: 900, gain: 0.12, sweepTo: 200 }); },
  dryFire() { tone({ freq: 1200, dur: 0.03, gain: 0.15 }); },
  reload() { tone({ freq: 700, dur: 0.05, gain: 0.2 }); setTimeout(() => tone({ freq: 500, dur: 0.05, gain: 0.2 }), 220); },
  hit() { tone({ freq: 1800, dur: 0.05, gain: 0.25 }); },
  headshot() { tone({ freq: 2400, dur: 0.07, gain: 0.3 }); tone({ freq: 1800, dur: 0.06, gain: 0.2 }); },
  kill() { tone({ freq: 660, dur: 0.09, gain: 0.25 }); setTimeout(() => tone({ freq: 990, dur: 0.12, gain: 0.25 }), 90); },
  hurt() { tone({ freq: 180, dur: 0.12, gain: 0.3, type: 'sawtooth', slideTo: 90 }); },
  explosion() {
    burst({ dur: 0.7, freq: 500, gain: 0.9, sweepTo: 60 });
    tone({ freq: 90, dur: 0.6, gain: 0.6, type: 'sine', slideTo: 30 });
  },
  beep() { tone({ freq: 1100, dur: 0.09, gain: 0.25 }); },
  plant() { tone({ freq: 880, dur: 0.1, gain: 0.25 }); setTimeout(() => tone({ freq: 880, dur: 0.1, gain: 0.25 }), 140); },
  defuse() { tone({ freq: 1320, dur: 0.08, gain: 0.2 }); },
  roundStart() { tone({ freq: 523, dur: 0.12, gain: 0.25 }); setTimeout(() => tone({ freq: 784, dur: 0.18, gain: 0.25 }), 130); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.25 }), i * 120)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.22 }), i * 130)); },
  buy() { tone({ freq: 980, dur: 0.06, gain: 0.2 }); },
  denied() { tone({ freq: 220, dur: 0.12, gain: 0.25, type: 'sawtooth' }); },
};
