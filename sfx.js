// Синтезированный звук в стиле GTA (WebAudio, без файлов)
let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;

function init() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return false;
  }
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  enabled = true;
  return true;
}

export function unlock() {
  if (!ctx) if (!init()) return;
  if (ctx.state === "suspended") ctx.resume();
}

function rampGain(g, t0, v0, v1, dur) {
  g.gain.setValueAtTime(Math.max(0.0001, v0), t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v1), t0 + dur);
}

function noise(t0, dur, vol, fcFrom, fcTo) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(fcFrom, t0);
  if (fcTo != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, fcTo), t0 + dur);
  const g = ctx.createGain();
  rampGain(g, t0, vol, 0.0001, dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function osc(t0, dur, vol, f0, f1, type = "sine") {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  rampGain(g, t0, vol, 0.0001, dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// глухой удар по телу
function hitBurst(t0, dur, vol, f0, f1) {
  osc(t0, dur, vol, f0, f1, "sine");
  noise(t0, dur * 0.6, vol * 0.7, 4000, 800);
}

export const sfx = {
  setEnabled(v) {
    enabled = v;
  },
  step(run = false) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.07, run ? 0.16 : 0.1, 500, 180);
    osc(t, 0.06, 0.08, 140, 90, "sine");
  },
  jump() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.16);
    const g = ctx.createGain();
    rampGain(g, t, 0.14, 0.0001, 0.16);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.2);
  },
  land() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.12, 0.14, 700, 150);
    osc(t, 0.1, 0.1, 120, 70, "sine");
  },
  punch(heavy = false) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    // свист руки (скользящий фильтр вверх)
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.1);
    const g = ctx.createGain();
    rampGain(g, t, 0.07, 0.0001, 0.11);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.15);
    // удар по телу
    this.body(heavy ? 0.14 : 0.1, heavy ? 0.5 : 0.4, heavy ? 190 : 240, heavy ? 60 : 80);
  },
  kick() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.14, 0.35, 220, 60); // ударная масса подъёма
    this.body(0.18, 0.55, 150, 45);
  },
  body(dur, vol, f0, f1) {
    // глухой удар по телу
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    rampGain(g, t, vol, 0.0001, dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
    noise(t, dur * 0.5, vol * 0.6, 3500, 700);
  },
  hurt() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    osc(t, 0.16, 0.28, 220, 60, "triangle");
    noise(t, 0.1, 0.18, 1400, 250);
  },
  death() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.32, 0.22, 900, 120);
    osc(t, 0.4, 0.3, 110, 30, "sine");
    osc(t + 0.2, 0.5, 0.22, 300, 40, "triangle");
  },
  respawn() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    osc(t, 0.25, 0.2, 440, 480, "sine");
    osc(t + 0.14, 0.3, 0.22, 660, 700, "sine");
    osc(t + 0.28, 0.4, 0.24, 880, 940, "sine");
  },
  money() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    osc(t, 0.08, 0.18, 1567, 1567, "square");
    osc(t + 0.09, 0.16, 0.18, 2093, 2093, "square");
  },
  armorPickup() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    osc(t, 0.12, 0.24, 520, 660, "square");
    osc(t + 0.1, 0.2, 0.26, 780, 1040, "square");
    noise(t, 0.1, 0.2, 2500, 1200);
  },
  sit() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    noise(t, 0.2, 0.16, 300, 700);
    osc(t, 0.18, 0.1, 90, 60, "sine");
  },
  chat(beep = false) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    if (beep) osc(t, 0.12, 0.1, 1200, 1200, "square");
    else {
      osc(t, 0.12, 0.1, 1000, 1000, "sine");
      osc(t + 0.12, 0.15, 0.12, 1300, 1300, "sine");
    }
  },
  radio(open = false) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    osc(t, 0.08, 0.18, open ? 1200 : 800, open ? 1200 : 800, "square");
  },
  ambient(on) {
    if (!enabled || !ctx) return;
    if (!on) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    return () => {
      try {
        src.stop();
      } catch {}
    };
  },
};
