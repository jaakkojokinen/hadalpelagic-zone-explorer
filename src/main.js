import './styles.css';
import { createTrenchScene } from './scene.js';

const canvas = document.querySelector('#trench-scene');
const loading = document.querySelector('#loading');
const hud = {
  depth: document.querySelector('#metric-depth'),
  convergence: document.querySelector('#metric-convergence'),
  age: document.querySelector('#metric-age'),
  title: document.querySelector('#readout-title'),
  body: document.querySelector('#readout-body'),
  navButtons: document.querySelectorAll('[data-view]'),
};

createTrenchScene(canvas, hud);

requestAnimationFrame(() => {
  loading.classList.add('loading--hidden');
});
