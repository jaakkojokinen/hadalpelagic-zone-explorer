const STEPS = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.12;

export const DEFAULT_PATTERNS = {
  kick: 'x---x---x---x---',
  snare: '----x-------x---',
  hihats: 'x-x-x-x-x-x-x-x-',
  tom: '------------x---',
  modA: 'x-------x-------',
  modB: '--x---x---x---x-',
};

const TRACKS = [
  { id: 'kick', label: 'Kick', type: 'drum' },
  { id: 'snare', label: 'Snare', type: 'drum' },
  { id: 'hihats', label: 'Hats', type: 'drum' },
  { id: 'tom', label: 'Tom', type: 'drum' },
  { id: 'modA', label: 'Sine A', type: 'sine' },
  { id: 'modB', label: 'Sine B', type: 'sine' },
];

function normalizePattern(pattern) {
  return String(pattern ?? '')
    .padEnd(STEPS, '-')
    .slice(0, STEPS)
    .replace(/[^xX-]/g, '-')
    .toLowerCase();
}

function makeStepButtons(track, state, onToggle) {
  return Array.from({ length: STEPS }, (_, step) => {
    const button = document.createElement('button');
    button.className = 'sequencer__step';
    button.type = 'button';
    button.setAttribute('aria-label', `${track.label} step ${step + 1}`);
    button.addEventListener('click', () => onToggle(track.id, step));
    return button;
  });
}

function makeNoiseBuffer(audio, durationSeconds = 0.2) {
  const buffer = audio.createBuffer(1, Math.max(1, audio.sampleRate * durationSeconds), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function envelope(audio, destination, time, peak, attack, decay) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  gain.connect(destination);
  return gain;
}

function playKick(audio, destination, time) {
  const osc = audio.createOscillator();
  const amp = envelope(audio, destination, time, 0.95, 0.004, 0.24);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(145, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.18);
  osc.connect(amp);
  osc.start(time);
  osc.stop(time + 0.26);
}

function playSnare(audio, destination, time, noiseBuffer) {
  const noise = audio.createBufferSource();
  const noiseAmp = envelope(audio, destination, time, 0.42, 0.003, 0.16);
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1700, time);
  filter.Q.setValueAtTime(0.9, time);
  noise.buffer = noiseBuffer;
  noise.connect(filter).connect(noiseAmp);
  noise.start(time);
  noise.stop(time + 0.18);

  const body = audio.createOscillator();
  const bodyAmp = envelope(audio, destination, time, 0.16, 0.004, 0.09);
  body.type = 'triangle';
  body.frequency.setValueAtTime(190, time);
  body.connect(bodyAmp);
  body.start(time);
  body.stop(time + 0.11);
}

function playHat(audio, destination, time, noiseBuffer) {
  const noise = audio.createBufferSource();
  const amp = envelope(audio, destination, time, 0.24, 0.001, 0.055);
  const filter = audio.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(6500, time);
  noise.buffer = noiseBuffer;
  noise.connect(filter).connect(amp);
  noise.start(time);
  noise.stop(time + 0.07);
}

function playTom(audio, destination, time) {
  const osc = audio.createOscillator();
  const amp = envelope(audio, destination, time, 0.5, 0.006, 0.2);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(210, time);
  osc.frequency.exponentialRampToValueAtTime(92, time + 0.16);
  osc.connect(amp);
  osc.start(time);
  osc.stop(time + 0.24);
}

function playSine(audio, destination, time, id, step) {
  const osc = audio.createOscillator();
  const mod = audio.createOscillator();
  const modDepth = audio.createGain();
  const amp = envelope(audio, destination, time, id === 'modA' ? 0.2 : 0.15, 0.012, 0.32);
  const root = id === 'modA' ? 82.41 : 123.47;
  const interval = id === 'modA' ? [0, 7, 10, 12] : [0, 3, 5, 10];
  const semitone = interval[(step / 2) % interval.length | 0];
  osc.type = 'sine';
  mod.type = 'sine';
  osc.frequency.setValueAtTime(root * 2 ** (semitone / 12), time);
  mod.frequency.setValueAtTime(id === 'modA' ? 5.5 : 8.2, time);
  modDepth.gain.setValueAtTime(id === 'modA' ? 12 : 20, time);
  mod.connect(modDepth).connect(osc.frequency);
  osc.connect(amp);
  mod.start(time);
  osc.start(time);
  mod.stop(time + 0.38);
  osc.stop(time + 0.38);
}

export function createMusicModule(root) {
  if (!root) return null;

  const state = {
    audio: null,
    master: null,
    noiseBuffer: null,
    isPlaying: false,
    bpm: 104,
    step: 0,
    nextStepAt: 0,
    clockZero: 0,
    timer: null,
    patterns: Object.fromEntries(Object.entries(DEFAULT_PATTERNS).map(([key, value]) => [key, normalizePattern(value)])),
  };

  const els = {
    play: root.querySelector('[data-sequencer-play]'),
    bpm: root.querySelector('[data-sequencer-bpm]'),
    grid: root.querySelector('[data-sequencer-grid]'),
    code: root.querySelector('[data-sequencer-code]'),
  };

  const stepButtons = new Map();

  function ensureAudio() {
    if (state.audio) return;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;
    state.audio = new AudioContextClass();
    state.master = state.audio.createGain();
    state.master.gain.value = 0.74;
    state.master.connect(state.audio.destination);
    state.noiseBuffer = makeNoiseBuffer(state.audio, 0.35);
  }

  function currentTime() {
    return state.audio?.currentTime ?? performance.now() / 1000 - state.clockZero;
  }

  function toggleStep(trackId, step) {
    const chars = state.patterns[trackId].split('');
    chars[step] = chars[step] === 'x' ? '-' : 'x';
    setPattern(trackId, chars.join(''));
  }

  function setPattern(trackId, pattern) {
    if (!state.patterns[trackId]) return;
    state.patterns[trackId] = normalizePattern(pattern);
    render();
  }

  function setPatterns(patterns) {
    Object.entries(patterns).forEach(([trackId, pattern]) => setPattern(trackId, pattern));
  }

  function scheduleStep(step, time) {
    if (!state.audio) return;
    TRACKS.forEach((track) => {
      if (state.patterns[track.id][step] !== 'x') return;
      if (track.id === 'kick') playKick(state.audio, state.master, time);
      if (track.id === 'snare') playSnare(state.audio, state.master, time, state.noiseBuffer);
      if (track.id === 'hihats') playHat(state.audio, state.master, time, state.noiseBuffer);
      if (track.id === 'tom') playTom(state.audio, state.master, time);
      if (track.type === 'sine') playSine(state.audio, state.master, time, track.id, step);
    });
  }

  function scheduler() {
    const secondsPerStep = 60 / state.bpm / 4;
    const now = currentTime();
    while (state.nextStepAt < now + SCHEDULE_AHEAD_SECONDS) {
      scheduleStep(state.step, state.nextStepAt);
      const activeStep = state.step;
      window.setTimeout(() => {
        root.style.setProperty('--sequencer-step', activeStep);
        renderActiveStep(activeStep);
      }, Math.max(0, (state.nextStepAt - currentTime()) * 1000));
      state.step = (state.step + 1) % STEPS;
      state.nextStepAt += secondsPerStep;
    }
  }

  async function start() {
    ensureAudio();
    if (state.audio) await state.audio.resume();
    state.clockZero = performance.now() / 1000;
    state.isPlaying = true;
    state.step = 0;
    state.nextStepAt = currentTime() + 0.045;
    els.play.textContent = 'Stop';
    els.play.setAttribute('aria-pressed', 'true');
    scheduler();
    state.timer = window.setInterval(scheduler, LOOKAHEAD_MS);
  }

  function stop() {
    state.isPlaying = false;
    window.clearInterval(state.timer);
    state.timer = null;
    els.play.textContent = 'Play';
    els.play.setAttribute('aria-pressed', 'false');
    renderActiveStep(-1);
  }

  function renderActiveStep(activeStep) {
    stepButtons.forEach((buttons) => {
      buttons.forEach((button, index) => {
        button.classList.toggle('sequencer__step--current', index === activeStep);
      });
    });
  }

  function renderCode() {
    els.code.textContent = `trenchSequencer.setPattern('kick', '${state.patterns.kick}');
trenchSequencer.setPattern('snare', '${state.patterns.snare}');
trenchSequencer.setPattern('hihats', '${state.patterns.hihats}');
trenchSequencer.setPattern('tom', '${state.patterns.tom}');
trenchSequencer.setPattern('modA', '${state.patterns.modA}');
trenchSequencer.setPattern('modB', '${state.patterns.modB}');`;
  }

  function render() {
    TRACKS.forEach((track) => {
      const buttons = stepButtons.get(track.id) ?? [];
      buttons.forEach((button, step) => {
        button.classList.toggle('sequencer__step--on', state.patterns[track.id][step] === 'x');
      });
    });
    renderCode();
  }

  TRACKS.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'sequencer__row';
    row.dataset.track = track.id;

    const label = document.createElement('span');
    label.className = 'sequencer__track';
    label.textContent = track.label;
    row.append(label);

    const buttons = makeStepButtons(track, state, toggleStep);
    buttons.forEach((button) => row.append(button));
    stepButtons.set(track.id, buttons);
    els.grid.append(row);
  });

  els.play.addEventListener('click', () => {
    if (state.isPlaying) {
      stop();
    } else {
      start();
    }
  });

  els.bpm.addEventListener('input', () => {
    state.bpm = Number(els.bpm.value);
    root.querySelector('[data-sequencer-bpm-value]').textContent = state.bpm;
  });

  render();

  return {
    get patterns() {
      return { ...state.patterns };
    },
    setPattern,
    setPatterns,
    start,
    stop,
  };
}
