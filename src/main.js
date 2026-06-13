import './styles.css';
import { createTrenchScene } from './scene.js';
import { createMusicModule } from './musicModule.js';

const canvas = document.querySelector('#trench-scene');
const loading = document.querySelector('#loading');
const sequencer = createMusicModule(document.querySelector('#music-module'));
const hud = {
  depth: document.querySelector('#metric-depth'),
  convergence: document.querySelector('#metric-convergence'),
  age: document.querySelector('#metric-age'),
  title: document.querySelector('#readout-title'),
  body: document.querySelector('#readout-body'),
  navButtons: document.querySelectorAll('[data-view]'),
  abyssCritters: document.querySelector('#abyss-critters'),
  critterTooltip: document.querySelector('#critter-tooltip'),
};

createTrenchScene(canvas, hud, {
  onCritterObserveChange: (active) => sequencer?.setCritterMode(active),
  onCritterPad: (event) => sequencer?.triggerCritterPad(event),
});
window.trenchSequencer = sequencer;
globalThis.trenchSequencer = sequencer;

requestAnimationFrame(() => {
  loading.classList.add('loading--hidden');
});
