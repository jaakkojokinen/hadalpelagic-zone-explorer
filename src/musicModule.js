const STEPS = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const PAD_ROOT_FREQUENCY = 110;
const PAD_SCALE_NAME = 'hadal minor';
const PAD_SCALE_DEGREES = [0, 2, 3, 5, 7, 10, 12, 14, 15, 17, 19, 22, 24, 26, 27, 29];

export const DEFAULT_PATTERNS = {
  kick: 'x---x---x---x---',
  snare: '----x-------x---',
  hihats: 'x-x-x-x-x-x-x-x-',
  tom: '------------x---',
  modA: 'x-------x-------',
  modB: 'x-------x-------',
  modC: 'x-------x-------',
};

const TRACKS = [
  { id: 'kick', label: 'Kick', type: 'drum' },
  { id: 'snare', label: 'Snare', type: 'drum' },
  { id: 'hihats', label: 'Hats', type: 'drum' },
  { id: 'tom', label: 'Tom', type: 'drum' },
  { id: 'modA', label: 'Pad A', type: 'sine' },
  { id: 'modB', label: 'Pad B', type: 'sine' },
  { id: 'modC', label: 'Pad C', type: 'sine' },
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

function makeClearButton(track, onClear) {
  const button = document.createElement('button');
  button.className = 'sequencer__clear';
  button.type = 'button';
  button.textContent = 'Clear';
  button.setAttribute('aria-label', `Clear ${track.label} row`);
  button.addEventListener('click', () => onClear(track.id));
  return button;
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

function padEnvelope(audio, destination, time, peak, attack, hold, release) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  gain.gain.setTargetAtTime(peak * 0.72, time + attack + hold, release * 0.32);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
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

function playSine(audio, destination, time, id, step, intensity = 1) {
  const osc = audio.createOscillator();
  const mod = audio.createOscillator();
  const modDepth = audio.createGain();
  const filter = audio.createBiquadFilter();
  const amp = padEnvelope(audio, destination, time, 0.11 * intensity, 0.18, 0.9, 2.7);
  const voiceIndex = { modA: 0, modB: 1, modC: 2 }[id] ?? 0;
  const scaleStep = (step + voiceIndex * 2) % PAD_SCALE_DEGREES.length;
  const semitone = PAD_SCALE_DEGREES[scaleStep] + voiceIndex * 12;
  osc.type = 'sine';
  mod.type = 'sine';
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(920 + voiceIndex * 180, time);
  filter.Q.setValueAtTime(0.7, time);
  osc.frequency.setValueAtTime(PAD_ROOT_FREQUENCY * 2 ** (semitone / 12), time);
  mod.frequency.setValueAtTime(0.35 + voiceIndex * 0.18, time);
  modDepth.gain.setValueAtTime(2.5 + voiceIndex * 1.2, time);
  mod.connect(modDepth).connect(osc.frequency);
  osc.connect(filter).connect(amp);
  mod.start(time);
  osc.start(time);
  mod.stop(time + 3.8);
  osc.stop(time + 3.8);
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
    audioError: '',
    critterMode: false,
    restorePlaying: false,
    patterns: Object.fromEntries(Object.entries(DEFAULT_PATTERNS).map(([key, value]) => [key, normalizePattern(value)])),
  };

  const els = {
    play: root.querySelector('[data-sequencer-play]'),
    bpm: root.querySelector('[data-sequencer-bpm]'),
    grid: root.querySelector('[data-sequencer-grid]'),
    code: root.querySelector('[data-sequencer-code]'),
  };

  const stepButtons = new Map();
  const clearButtons = new Map();

  function setPlayStatus(text, pressed = false) {
    els.play.textContent = text;
    els.play.setAttribute('aria-pressed', String(pressed));
    els.play.title = state.audioError;
  }

  function ensureAudio() {
    if (state.audio?.state === 'closed') {
      state.audio = null;
      state.master = null;
      state.noiseBuffer = null;
    }
    if (state.audio) return true;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      state.audioError = 'Web Audio is not available in this browser.';
      return false;
    }
    try {
      state.audio = new AudioContextClass();
      state.master = state.audio.createGain();
      state.master.gain.value = 0.74;
      state.master.connect(state.audio.destination);
      state.noiseBuffer = makeNoiseBuffer(state.audio, 0.35);
      state.audioError = '';
      return true;
    } catch (error) {
      state.audio = null;
      state.master = null;
      state.noiseBuffer = null;
      state.audioError = error instanceof Error ? error.message : 'Unable to start Web Audio.';
      return false;
    }
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

  function clearPattern(trackId) {
    setPattern(trackId, '-'.repeat(STEPS));
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
    if (!ensureAudio()) {
      setPlayStatus('No audio');
      window.setTimeout(() => setPlayStatus('Play'), 1400);
      return;
    }
    try {
      await state.audio.resume();
    } catch (error) {
      state.audioError = error instanceof Error ? error.message : 'Unable to resume Web Audio.';
      setPlayStatus('No audio');
      window.setTimeout(() => setPlayStatus('Play'), 1400);
      return;
    }
    if (state.audio.state !== 'running') {
      state.audioError = `Audio context is ${state.audio.state}.`;
      setPlayStatus('No audio');
      window.setTimeout(() => setPlayStatus('Play'), 1400);
      return;
    }
    state.clockZero = performance.now() / 1000;
    state.isPlaying = true;
    state.step = 0;
    state.nextStepAt = currentTime() + 0.045;
    setPlayStatus('Stop', true);
    scheduler();
    state.timer = window.setInterval(scheduler, LOOKAHEAD_MS);
  }

  function stop() {
    state.isPlaying = false;
    window.clearInterval(state.timer);
    state.timer = null;
    setPlayStatus('Play');
    renderActiveStep(-1);
  }

  function setControlsDisabled(disabled) {
    els.play.disabled = disabled;
    els.bpm.disabled = disabled;
    stepButtons.forEach((buttons) => {
      buttons.forEach((button) => {
        button.disabled = disabled;
      });
    });
    clearButtons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function setCritterMode(active) {
    if (state.critterMode === active) return;
    state.critterMode = active;
    root.classList.toggle('music-module--critter-mode', active);

    if (active) {
      state.restorePlaying = state.isPlaying;
      if (state.isPlaying) stop();
      setControlsDisabled(true);
      setPlayStatus('Critter');
      if (ensureAudio()) {
        state.audio.resume().catch((error) => {
          state.audioError = error instanceof Error ? error.message : 'Unable to resume Web Audio.';
        });
      }
      return;
    }

    setControlsDisabled(false);
    setPlayStatus('Play');
    if (state.restorePlaying) {
      state.restorePlaying = false;
      start();
    }
  }

  function triggerCritterPad({ trackId = 'modA', step = 0, intensity = 1 } = {}) {
    if (!state.critterMode || !ensureAudio() || state.audio.state !== 'running') return;
    playSine(state.audio, state.master, state.audio.currentTime + 0.01, trackId, step, intensity);
    renderActiveStep(step);
    window.setTimeout(() => renderActiveStep(-1), 180);
  }

  function renderActiveStep(activeStep) {
    stepButtons.forEach((buttons) => {
      buttons.forEach((button, index) => {
        button.classList.toggle('sequencer__step--current', index === activeStep);
      });
    });
  }

  function renderCode() {
    els.code.textContent = `// Pad scale: ${PAD_SCALE_NAME}
trenchSequencer.setPattern('kick', '${state.patterns.kick}');
trenchSequencer.setPattern('snare', '${state.patterns.snare}');
trenchSequencer.setPattern('hihats', '${state.patterns.hihats}');
trenchSequencer.setPattern('tom', '${state.patterns.tom}');
trenchSequencer.setPattern('modA', '${state.patterns.modA}');
trenchSequencer.setPattern('modB', '${state.patterns.modB}');
trenchSequencer.setPattern('modC', '${state.patterns.modC}');`;
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
    const clearButton = makeClearButton(track, clearPattern);
    clearButtons.set(track.id, clearButton);
    row.append(clearButton);
    els.grid.append(row);
  });

  els.play.addEventListener('click', () => {
    if (state.critterMode) return;
    if (state.isPlaying) {
      stop();
    } else {
      start().catch((error) => {
        state.audioError = error instanceof Error ? error.message : 'Unable to start sequencer.';
        setPlayStatus('No audio');
        window.setTimeout(() => setPlayStatus('Play'), 1400);
      });
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
    get padScale() {
      return {
        name: PAD_SCALE_NAME,
        rootFrequency: PAD_ROOT_FREQUENCY,
        degrees: [...PAD_SCALE_DEGREES],
      };
    },
    get audioState() {
      return {
        available: Boolean(window.AudioContext ?? window.webkitAudioContext),
        context: state.audio?.state ?? 'not-created',
        error: state.audioError,
        playing: state.isPlaying,
      };
    },
    setPattern,
    clearPattern,
    setPatterns,
    setCritterMode,
    triggerCritterPad,
    start,
    stop,
  };
}
