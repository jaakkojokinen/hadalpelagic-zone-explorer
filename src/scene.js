import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { WORLD, basinCenterX, elevationAt, heatFlowAt, makeQuakeCatalog, plateAgeAt } from './trenchData.js';

const layerText = {
  bathymetry: ['Bathymetry', 'Dynamic survey colors stretch with max depth: green-brown shallows, red middle slopes, and darker blues in the deepest basin.'],
  heat: ['Heat flow', 'Warm colors cluster under the volcanic arc while the subducting slab cools the trench and forearc.'],
  age: ['Oceanic plate age', 'Stripe bands show older, denser oceanic lithosphere bending into the subduction zone.'],
};

const bathymetryStops = [
  [0, 0x031331],
  [0.14, 0x07306f],
  [0.28, 0x005ca8],
  [0.42, 0x00a3bd],
  [0.55, 0xb01612],
  [0.66, 0xe36f1e],
  [0.78, 0x9fb338],
  [0.9, 0x238b45],
  [1, 0x6d5131],
].map(([stop, color]) => [stop, new THREE.Color(color)]);

const CRITTER_DEPTH_THRESHOLD_KM = 8;
const CRITTER_APPEAR_DELAY_SECONDS = 2.6;
const FORMATION_SCALE = 0.5;

function effectiveTrenchDepth(settings) {
  return settings.trenchDepth * settings.verticalExaggeration;
}

const cameraViews = {
  overview: {
    position: new THREE.Vector3(24, 19, 30),
    target: new THREE.Vector3(1, -1.7, 0),
    text: ['Bathymetry', 'Color follows seafloor elevation, revealing the outer rise, deep basin, accretionary wedge, and volcanic arc.'],
  },
  trench: {
    text: ['Basin floor', 'Scarps, talus blocks, sediment fans, and vent fields gather across the irregular central low.'],
  },
};

function cameraViewFor(viewName, settings) {
  if (viewName !== 'trench') return cameraViews.overview;

  const targetZ = WORLD.basinZ - 4.5;
  const centerX = basinCenterX(targetZ);
  const floorY = elevationAt(centerX, targetZ, settings) * settings.verticalExaggeration;
  return {
    position: new THREE.Vector3(centerX - 2.2, floorY + 2.15, targetZ + 10.5),
    target: new THREE.Vector3(centerX - 0.2, floorY + 1.1, targetZ - 0.8),
    text: cameraViews.trench.text,
  };
}

export function createTrenchScene(canvas, hud) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x07131a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07131a, 0.026);
  scene.environment = makeUnderwaterReflectionMap();

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  camera.position.copy(cameraViews.overview.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.copy(cameraViews.overview.target);
  controls.maxPolarAngle = Math.PI * 0.78;
  controls.minDistance = 4;
  controls.maxDistance = 72;
  controls.addEventListener('start', () => {
    viewTransition = false;
  });

  const settings = {
    layer: 'bathymetry',
    trenchDepth: 10,
    slabDip: 36,
    convergence: 78,
    waterLevel: 0,
    seaFog: true,
    fogThickness: 0.85,
    fogBurnOff: 0,
    animateFogBurnOff: false,
    quakes: false,
    heatPlumes: false,
    vectors: false,
    currents: true,
    thermocline: true,
    ageStripes: true,
    formations: true,
    formationDensity: 0.5,
    contours: true,
    explorationMode: 'overview',
    verticalExaggeration: 1,
    thermalVents: 0.7,
  };

  const cameraGoal = {
    position: cameraViews.overview.position.clone(),
    target: cameraViews.overview.target.clone(),
  };
  let viewTransition = false;
  const pointer = new THREE.Vector2(2, 2);
  const raycaster = new THREE.Raycaster();
  const critterReveal = {
    activationStartedAt: null,
    visibleAmount: 0,
  };

  const group = new THREE.Group();
  scene.add(group);

  const terrain = makeTerrain(settings);
  group.add(terrain);
  const contours = makeDepthContours(settings);
  group.add(contours);
  const water = makeWater(settings);
  group.add(water);
  const seaFog = makeSeaFog(settings);
  group.add(seaFog);
  const slab = makeSlab(settings);
  group.add(slab);
  const quakes = makeQuakes();
  quakes.visible = settings.quakes;
  group.add(quakes);
  const vectors = makeVectors(settings);
  vectors.visible = settings.vectors;
  group.add(vectors);
  const currents = makeCurrents();
  group.add(currents);
  const thermocline = makeThermoclineAcoustics();
  group.add(thermocline);
  const plumes = makePlumes(settings);
  plumes.visible = settings.heatPlumes;
  group.add(plumes);
  const formations = makeTrenchFormations(settings);
  group.add(formations);
  const critters = makeBioluminescentCritters(settings);
  group.add(critters);
  const mirrorBall = makeMirrorBall(settings);
  group.add(mirrorBall);
  const particulates = makeMarineSnow();
  scene.add(particulates);

  const ambient = new THREE.HemisphereLight(0xaed9ff, 0x102128, 1.7);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2d5, 2.4);
  key.position.set(-12, 24, 16);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x58d7ff, 1.2);
  rim.position.set(18, 10, -22);
  scene.add(rim);
  const trenchLight = new THREE.PointLight(0x6de7ff, 2.8, 22, 1.8);
  trenchLight.position.set(basinCenterX(WORLD.basinZ) - 1, -6.4, WORLD.basinZ - 4);
  scene.add(trenchLight);

  const gui = new GUI({ title: 'Data layers' });
  addTooltip(gui.domElement, 'Controls for camera mode, geologic parameters, data layers, and visible scene annotations.');
  const explorationController = withTooltip(
    gui.add(settings, 'explorationMode', ['overview', 'trench']).name('Explore').onChange(setView),
    'Moves the camera between overview and basin-floor starting positions without locking exploration.',
  );
  const surfaceController = withTooltip(
    gui.add(settings, 'layer', ['bathymetry', 'heat', 'age']).name('Surface color').onChange(refresh),
    'Changes the terrain color layer: bathymetric depth, heat flow, or oceanic plate age.',
  );
  withTooltip(
    gui.add(settings, 'trenchDepth', 4.5, 10, 0.1).name('Max depth').onChange(refreshGeometry),
    'Deepens or shallows the basin in physical kilometers; depth contours rescale from this value.',
  );
  withTooltip(
    gui.add(settings, 'slabDip', 18, 62, 1).name('Slab dip').onChange(refreshGeometry),
    'Tilts the subducting slab and earthquake band beneath the basin.',
  );
  withTooltip(
    gui.add(settings, 'convergence', 20, 120, 1).name('Convergence').onChange(refreshGeometry),
    'Controls plate-motion vector length and the convergence metric in millimeters per year.',
  );
  withTooltip(
    gui.add(settings, 'verticalExaggeration', 0.75, 2.1, 0.05).name('Vertical scale').onChange(refreshGeometry),
    'Scales vertical relief and the effective depth used by the max-depth readout and deep-water life threshold.',
  );
  withTooltip(gui.add(settings, 'waterLevel', -1.5, 1.8, 0.05).name('Sea level').onChange(() => {
    water.position.y = settings.waterLevel;
    updateSeaFog(seaFog, settings);
  }), 'Moves the transparent water surface up or down.');
  withTooltip(gui.add(settings, 'seaFog').name('Sea fog').onChange((v) => { seaFog.visible = v; }), 'Shows a cold, saturated marine fog layer riding just above the sea surface.');
  withTooltip(gui.add(settings, 'fogThickness', 0.05, 2.4, 0.05).name('Fog thickness').onChange(() => {
    updateSeaFog(seaFog, settings);
  }), 'Controls the depth of the near-surface fog layer, like a thicker or shallower saturated marine boundary layer.');
  const fogBurnOffController = withTooltip(gui.add(settings, 'fogBurnOff', 0, 1, 0.01).name('Fog burn-off').onChange(() => {
    updateSeaFog(seaFog, settings);
  }), 'Warms and mixes the fog layer so droplets evaporate into broken patches rather than disappearing all at once.');
  withTooltip(gui.add(settings, 'animateFogBurnOff').name('Animate burn-off'), 'Animates realistic fog dissipation: morning-thick fog becomes patchier as sunlight and turbulent mixing lower relative humidity.');
  withTooltip(gui.add(settings, 'currents').name('Water currents').onChange((v) => { currents.visible = v; }), 'Shows or hides slow water-current ribbons in the basin water column.');
  withTooltip(gui.add(settings, 'thermocline').name('Thermocline sonar').onChange((v) => { thermocline.visible = v; }), 'Shows the Cold War-relevant thermocline, deep sound channel, acoustic ray bending, and shadow zone below about 1 km.');
  withTooltip(gui.add(settings, 'ageStripes').name('Age stripes').onChange(refresh), 'Adds stripe banding to the plate-age color layer.');
  withTooltip(gui.add(settings, 'formations').name('Basin formations').onChange((v) => { formations.visible = v; }), 'Shows or hides scarps, talus, sediment fans, and vent structures inside the basin.');
  withTooltip(gui.add(settings, 'formationDensity', 0, 1, 0.05).name('Formation density').onChange(() => {
    updateTrenchFormations(formations, settings);
  }), 'Controls how many generated basin formations are visible.');
  withTooltip(gui.add(settings, 'contours').name('Depth contours').onChange(refresh), 'Shows scalable white depth-contour lines on the bathymetry layer.');

  hud.navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      explorationController.setValue(button.dataset.view);
    });
  });

  function refreshGeometry() {
    updateTerrain(terrain, settings);
    updateDepthContours(contours, settings);
    updateSlab(slab, settings);
    updateVectors(vectors, settings);
    updateTrenchFormations(formations, settings);
    updateBioluminescentCritterPositions(critters, settings);
    updateMirrorBall(mirrorBall, settings);
    updateMetrics(settings, hud);
    refresh();
  }

  function refresh() {
    colorTerrain(terrain.geometry, settings);
    contours.visible = settings.contours && settings.layer === 'bathymetry';
    const [title, body] = layerText[settings.layer];
    hud.title.textContent = title;
    hud.body.textContent = body;
    addTooltip(surfaceController.domElement, `${title}: ${body}`);
  }

  function setView(viewName) {
    const view = cameraViewFor(viewName, settings);
    settings.explorationMode = viewName;
    cameraGoal.position.copy(view.position);
    cameraGoal.target.copy(view.target);
    viewTransition = true;
    hud.title.textContent = view.text[0];
    hud.body.textContent = view.text[1];
    hud.navButtons.forEach((button) => {
      button.classList.toggle('hud__nav-button--active', button.dataset.view === viewName);
    });
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight, false);
  }

  updateMetrics(settings, hud);
  refresh();
  setView(settings.explorationMode);
  resize();

  window.addEventListener('resize', resize);
  canvas.addEventListener('pointermove', updateCritterTooltip);
  canvas.addEventListener('pointerdown', updateCritterTooltip);
  canvas.addEventListener('pointerleave', hideCritterTooltip);

  let rafId = 0;
  const clock = new THREE.Clock();
  function animate() {
    const elapsed = clock.getElapsedTime();
    if (viewTransition) {
      camera.position.lerp(cameraGoal.position, 0.035);
      controls.target.lerp(cameraGoal.target, 0.04);
      if (camera.position.distanceTo(cameraGoal.position) < 0.08 && controls.target.distanceTo(cameraGoal.target) < 0.08) {
        viewTransition = false;
      }
    }
    controls.update();
    water.material.uniforms.uTime.value = elapsed;
    if (settings.animateFogBurnOff) {
      settings.fogBurnOff = (Math.sin(elapsed * 0.18 - Math.PI / 2) + 1) * 0.5;
      fogBurnOffController.updateDisplay();
      updateSeaFog(seaFog, settings);
    }
    updateAtmosphere(scene, renderer, ambient, key, rim, trenchLight, camera, settings);
    updateWaterOpacity(water, camera, settings);
    animateSeaFog(seaFog, elapsed, settings);
    animateQuakes(quakes, elapsed);
    animatePlumes(plumes, elapsed);
    animateMarineSnow(particulates, camera, elapsed);
    animateTrenchFormations(formations, elapsed);
    animateBioluminescentCritters(critters, critterReveal, elapsed, settings, camera, hud.abyssCritters);
    animateMirrorBall(mirrorBall, elapsed);
    animateVectors(vectors, elapsed, settings);
    animateCurrents(currents, elapsed);
    animateThermoclineAcoustics(thermocline, elapsed);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  animate();

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', updateCritterTooltip);
      canvas.removeEventListener('pointerdown', updateCritterTooltip);
      canvas.removeEventListener('pointerleave', hideCritterTooltip);
      gui.destroy();
      renderer.dispose();
    },
  };

  function updateCritterTooltip(event) {
    if (!hud.critterTooltip || !critters.visible) {
      hideCritterTooltip();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(critters.children.filter((object) => object.userData.isCritter), false);

    if (hits.length === 0 || hits[0].object.material.opacity < 0.08) {
      hideCritterTooltip();
      return;
    }

    const maxLeft = Math.max(12, window.innerWidth - 280);
    const maxTop = Math.max(72, window.innerHeight - 12);
    hud.critterTooltip.style.left = `${THREE.MathUtils.clamp(event.clientX, 12, maxLeft)}px`;
    hud.critterTooltip.style.top = `${THREE.MathUtils.clamp(event.clientY, 72, maxTop)}px`;
    hud.critterTooltip.classList.add('critter-tooltip--visible');
    hud.critterTooltip.setAttribute('aria-hidden', 'false');
  }

  function hideCritterTooltip() {
    if (!hud.critterTooltip) return;
    hud.critterTooltip.classList.remove('critter-tooltip--visible');
    hud.critterTooltip.setAttribute('aria-hidden', 'true');
  }
}

function withTooltip(controller, text) {
  addTooltip(controller.domElement, text);
  return controller;
}

function addTooltip(element, text) {
  element.title = text;
  element.querySelectorAll('.name, .widget, input, select, button').forEach((child) => {
    child.title = text;
  });
}

function makeUnderwaterReflectionMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#9be7f0');
  gradient.addColorStop(0.38, '#0b7181');
  gradient.addColorStop(0.64, '#142b57');
  gradient.addColorStop(1, '#130626');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 90; i += 1) {
    const x = (i * 79) % canvas.width;
    const y = 18 + ((i * 37) % 210);
    const radius = 8 + (i % 7) * 5;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 246, 190, 0.3)' : 'rgba(126, 231, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.32, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeMirrorBall(settings) {
  const geometry = new THREE.SphereGeometry(0.9, 30, 18);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x23282c,
    metalness: 1,
    roughness: 0.025,
    envMapIntensity: 3.2,
    flatShading: true,
  });
  const ball = new THREE.Mesh(geometry, material);
  ball.userData.depthKm = 4;
  ball.userData.baseScale = 1;
  ball.userData.phase = 0.4;
  updateMirrorBall(ball, settings);
  return ball;
}

function updateMirrorBall(ball, settings) {
  const baseY = -ball.userData.depthKm * settings.verticalExaggeration;
  ball.position.set(
    basinCenterX(WORLD.basinZ),
    baseY,
    WORLD.basinZ,
  );
  ball.userData.baseY = baseY;
}

function animateMirrorBall(ball, elapsed) {
  ball.rotation.y = elapsed * 0.24;
  ball.rotation.x = Math.sin(elapsed * 0.18) * 0.18;
  ball.position.y = ball.userData.baseY + Math.sin(elapsed * 0.72 + ball.userData.phase) * 0.08;
}

function makeTerrain(settings) {
  const geometry = new THREE.PlaneGeometry(WORLD.width, WORLD.length, WORLD.terrainSegments, WORLD.terrainSegments);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  updateTerrain(mesh, settings);
  return mesh;
}

function makeDepthContours(settings) {
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.86,
    depthTest: true,
    depthWrite: false,
  });
  const contours = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  contours.renderOrder = 3;
  updateDepthContours(contours, settings);
  return contours;
}

function updateDepthContours(contours, settings) {
  const positions = [];
  const columns = 84;
  const rows = 108;
  const xMin = -WORLD.width / 2;
  const zMin = -WORLD.length / 2;
  const xStep = WORLD.width / columns;
  const zStep = WORLD.length / rows;
  const levels = makeDepthContourLevels(settings);

  const values = Array.from({ length: rows + 1 }, (_, row) => (
    Array.from({ length: columns + 1 }, (_, column) => {
      const x = xMin + column * xStep;
      const z = zMin + row * zStep;
      return elevationAt(x, z, settings) * settings.verticalExaggeration;
    })
  ));

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = xMin + column * xStep;
      const x1 = x0 + xStep;
      const z0 = zMin + row * zStep;
      const z1 = z0 + zStep;
      const corners = [
        { x: x0, z: z0, y: values[row][column] },
        { x: x1, z: z0, y: values[row][column + 1] },
        { x: x1, z: z1, y: values[row + 1][column + 1] },
        { x: x0, z: z1, y: values[row + 1][column] },
      ];

      levels.forEach((level) => {
        const crossings = [];
        addContourCrossing(crossings, corners[0], corners[1], level);
        addContourCrossing(crossings, corners[1], corners[2], level);
        addContourCrossing(crossings, corners[2], corners[3], level);
        addContourCrossing(crossings, corners[3], corners[0], level);

        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const a = crossings[i];
          const b = crossings[i + 1];
          positions.push(a.x, a.y + 0.045, a.z, b.x, b.y + 0.045, b.z);
        }
      });
    }
  }

  contours.geometry.dispose();
  contours.geometry = new THREE.BufferGeometry();
  contours.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}

function makeDepthContourLevels(settings) {
  const physicalStep = settings.trenchDepth > 7.5 ? 1.25 : 1;
  const deepest = -settings.trenchDepth;
  const shallowest = 2.5;
  const levels = [];

  for (let y = deepest; y <= shallowest; y += physicalStep) {
    levels.push(y * settings.verticalExaggeration);
  }

  if (!levels.some((level) => Math.abs(level) < 0.001)) {
    levels.push(0);
  }

  return levels.sort((a, b) => a - b);
}

function addContourCrossing(crossings, a, b, level) {
  const min = Math.min(a.y, b.y);
  const max = Math.max(a.y, b.y);
  if (level < min || level > max || a.y === b.y) return;

  const t = (level - a.y) / (b.y - a.y);
  crossings.push({
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: level,
    z: THREE.MathUtils.lerp(a.z, b.z, t),
  });
}

function makeTrenchFormations(settings) {
  const group = new THREE.Group();
  const scarpMaterial = new THREE.MeshStandardMaterial({ color: 0x416b68, roughness: 0.94, metalness: 0.02 });
  const talusMaterial = new THREE.MeshStandardMaterial({ color: 0x293e40, roughness: 0.9 });
  const fanMaterial = new THREE.MeshStandardMaterial({ color: 0x9a8d73, roughness: 0.86, transparent: true, opacity: 0.72 });
  const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2d32, roughness: 0.78, metalness: 0.08 });

  for (let i = 0; i < 18; i += 1) {
    const z = -23 + i * 2.7;
    const wallSide = i % 2 ? -1 : 1;
    const scarp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.4 + (i % 4) * 0.22, 3.2), scarpMaterial.clone());
    scarp.userData = { kind: 'scarp', z, xOffset: wallSide * (4.4 + (i % 3) * 0.78), roll: wallSide * 0.38, densityRank: rankedNoise(i, 0.13) };
    group.add(scarp);
  }

  for (let i = 0; i < 34; i += 1) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + (i % 5) * 0.08, 0), talusMaterial.clone());
    rock.userData = {
      kind: 'talus',
      z: -20 + ((i * 1.37) % 36),
      xOffset: -5.2 + ((i * 2.13) % 10.4),
      spin: i * 0.37,
      densityRank: rankedNoise(i, 0.41),
    };
    group.add(rock);
  }

  for (let i = 0; i < 7; i += 1) {
    const fan = new THREE.Mesh(new THREE.CircleGeometry(1.5 + i * 0.08, 28, 0, Math.PI * 1.35), fanMaterial.clone());
    fan.userData = { kind: 'fan', z: -18 + i * 5.6, xOffset: 5.2 + Math.sin(i) * 1.1, densityRank: rankedNoise(i, 0.73) };
    group.add(fan);
  }

  for (let i = 0; i < 8; i += 1) {
    const vent = new THREE.Group();
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 0.9 + (i % 3) * 0.18, 9), ventMaterial.clone());
    vent.add(chimney);
    vent.userData = { kind: 'vent', z: -18 + i * 4.8, xOffset: -2.2 + Math.sin(i * 1.7) * 3.2, phase: i * 0.53, densityRank: rankedNoise(i, 0.91) };
    group.add(vent);
  }

  updateTrenchFormations(group, settings);
  return group;
}

function updateTrenchFormations(group, settings) {
  group.children.forEach((object) => {
    const { kind, z, xOffset = 0, roll = 0 } = object.userData;
    object.visible = object.userData.densityRank <= settings.formationDensity;
    const x = basinCenterX(z) + xOffset;
    const floorY = elevationAt(x, z, settings) * settings.verticalExaggeration;
    object.position.set(x, floorY + 0.12, z);

    if (kind === 'scarp') {
      object.position.y += 0.72 * FORMATION_SCALE;
      object.rotation.set(0.28, 0.12 + z * 0.015, roll);
      object.scale.setScalar(FORMATION_SCALE);
    } else if (kind === 'fan') {
      object.position.y += 0.04 * FORMATION_SCALE;
      object.rotation.set(-Math.PI / 2, 0, -0.7 + z * 0.03);
      object.scale.set(1.45 * FORMATION_SCALE, 0.82 * FORMATION_SCALE, FORMATION_SCALE);
    } else if (kind === 'vent') {
      object.position.y += 0.45 * FORMATION_SCALE;
      object.rotation.set(0, z * 0.05, 0);
      object.userData.baseRotationY = object.rotation.y;
      object.scale.setScalar(FORMATION_SCALE);
    } else {
      object.position.y += 0.22 * FORMATION_SCALE;
      object.rotation.set(object.userData.spin, z * 0.03, object.userData.spin * 0.6);
      object.scale.setScalar(FORMATION_SCALE);
    }
  });
}

function rankedNoise(index, salt) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function animateTrenchFormations(group, elapsed) {
  group.children.forEach((object) => {
    if (!object.visible || object.userData.kind !== 'vent') return;
    object.rotation.y = object.userData.baseRotationY + Math.sin(elapsed * 0.7 + object.userData.phase) * 0.035;
  });
}

function makeBioluminescentCritters(settings) {
  const group = new THREE.Group();
  group.visible = false;
  group.userData.readyAmount = 0;
  const textures = [
    makePixelCritterTexture('fish'),
    makePixelCritterTexture('jelly'),
    makePixelCritterTexture('shrimp'),
    makePixelCritterTexture('spider'),
  ];
  const glowTexture = makeGlowTexture();

  for (let i = 0; i < 20; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: textures[i % textures.length],
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x63f6ff,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }));
    aura.renderOrder = 1;
    sprite.userData = {
      index: i,
      zSeed: -17 + ((i * 5.9) % 34),
      xSeed: -3.4 + ((i * 2.73) % 6.8),
      depthOffset: 0.14 + (rankedNoise(i, 0.22) * 0.5),
      phase: rankedNoise(i, 0.37) * Math.PI * 2,
      swimSpeed: 0.34 + rankedNoise(i, 0.47) * 0.42,
      currentGrip: 0.25 + rankedNoise(i, 0.57) * 0.8,
      spawnDelay: rankedNoise(i, 0.67) * 4.8,
      baseScale: 0.22 + rankedNoise(i, 0.77) * 0.13,
      facing: rankedNoise(i, 0.87) > 0.5 ? 1 : -1,
      isCritter: true,
      aura,
    };
    group.add(aura);
    group.add(sprite);
  }

  updateBioluminescentCritterPositions(group, settings);
  return group;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(48, 48, 4, 48, 48, 46);
  gradient.addColorStop(0, 'rgba(140, 255, 247, 0.62)');
  gradient.addColorStop(0.32, 'rgba(84, 229, 255, 0.24)');
  gradient.addColorStop(0.72, 'rgba(56, 169, 220, 0.08)');
  gradient.addColorStop(1, 'rgba(56, 169, 220, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makePixelCritterTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#48f4ff';

  const colorA = '#66fff0';
  const colorB = '#28d8ff';
  const eye = '#021724';
  const rects = {
    fish: [
      [14, 26, 20, 10, colorA], [34, 28, 8, 6, colorB], [8, 28, 6, 6, colorA],
      [24, 22, 4, 4, colorA], [24, 36, 4, 4, colorB], [18, 30, 4, 4, eye],
    ],
    jelly: [
      [23, 16, 18, 12, colorA], [19, 24, 26, 8, colorA], [24, 32, 4, 16, colorB],
      [32, 32, 4, 20, colorA], [40, 32, 4, 14, colorB], [26, 22, 4, 4, eye], [36, 22, 4, 4, eye],
    ],
    shrimp: [
      [16, 26, 22, 8, colorA], [38, 28, 6, 5, colorA], [10, 28, 6, 5, colorB],
      [8, 24, 6, 3, colorA], [8, 35, 6, 3, colorB], [22, 22, 8, 4, colorA], [24, 34, 8, 4, colorB],
    ],
    spider: [
      [26, 18, 12, 4, colorA], [22, 22, 20, 4, colorA], [18, 26, 28, 10, colorA],
      [22, 36, 20, 4, colorA], [26, 40, 12, 4, colorA], [12, 18, 10, 4, colorB],
      [8, 14, 4, 4, colorB], [6, 10, 4, 4, colorB], [10, 38, 10, 4, colorB],
      [6, 42, 4, 6, colorB], [44, 18, 8, 4, colorB], [52, 14, 4, 4, colorB],
      [56, 10, 4, 6, colorB], [44, 40, 10, 4, colorB], [54, 44, 4, 6, colorB],
      [48, 26, 8, 4, colorB], [56, 30, 4, 4, colorB], [8, 28, 10, 4, colorB],
      [4, 32, 4, 4, colorB], [26, 28, 4, 4, eye], [36, 28, 4, 4, eye],
    ],
  }[kind];

  rects.forEach(([x, y, w, h, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function updateBioluminescentCritterPositions(group, settings) {
  const floorLimit = -CRITTER_DEPTH_THRESHOLD_KM - 0.12;
  group.children.forEach((sprite) => {
    if (!sprite.material.map || !sprite.userData.zSeed) return;
    const { zSeed, xSeed, depthOffset } = sprite.userData;
    const z = zSeed + Math.sin(zSeed * 0.31) * 1.1;
    const x = basinCenterX(z) + xSeed;
    const floorY = elevationAt(x, z, settings) * settings.verticalExaggeration;
    const y = Math.min(floorY + depthOffset, floorLimit - rankedNoise(sprite.userData.index, 0.94) * 0.55);
    sprite.userData.anchor = new THREE.Vector3(x, y, z);
    sprite.position.copy(sprite.userData.anchor);
    sprite.userData.aura.position.copy(sprite.userData.anchor);
    sprite.scale.setScalar(sprite.userData.baseScale);
    sprite.userData.aura.scale.setScalar(sprite.userData.baseScale * 4.8);
  });
}

function animateBioluminescentCritters(group, reveal, elapsed, settings, camera, overlay) {
  const depthReady = effectiveTrenchDepth(settings) >= CRITTER_DEPTH_THRESHOLD_KM && camera.position.y < -1.2;

  if (!depthReady) {
    reveal.activationStartedAt = null;
    reveal.visibleAmount = 0;
  } else if (reveal.activationStartedAt === null) {
    reveal.activationStartedAt = elapsed;
  } else {
    const delayed = elapsed - reveal.activationStartedAt - CRITTER_APPEAR_DELAY_SECONDS;
    reveal.visibleAmount = THREE.MathUtils.smoothstep(delayed, 0, 2.4);
  }

  group.visible = reveal.visibleAmount > 0.01;
  overlay?.classList.remove('abyss-critters--visible');

  group.children.forEach((sprite) => {
    if (!sprite.material.map || !sprite.userData.anchor) return;
    const { anchor, phase, swimSpeed, currentGrip, spawnDelay, baseScale, facing, index } = sprite.userData;
    const localReveal = THREE.MathUtils.smoothstep(elapsed - (reveal.activationStartedAt ?? elapsed) - CRITTER_APPEAR_DELAY_SECONDS - spawnDelay, 0, 2.6);
    const t = elapsed * swimSpeed + phase;
    const current = settings.currents ? currentVectorAt(anchor, elapsed, index).multiplyScalar(currentGrip) : new THREE.Vector3();
    const ownPath = new THREE.Vector3(
      Math.sin(t * 1.3) * 0.34,
      Math.sin(t * 1.9 + index) * 0.12,
      Math.cos(t * 0.9) * 0.46,
    );

    sprite.position.copy(anchor).add(ownPath).add(current);
    const pulse = 0.42 + Math.sin(t * 3.1) * 0.16;
    const opacity = reveal.visibleAmount * localReveal * pulse;
    sprite.material.opacity = opacity;
    sprite.material.rotation = Math.sin(t * 0.8) * 0.22;
    sprite.scale.set(baseScale * facing * (1 + Math.sin(t) * 0.08), baseScale * (1 + Math.cos(t * 1.2) * 0.08), 1);

    sprite.userData.aura.position.copy(sprite.position);
    sprite.userData.aura.material.opacity = Math.min(0.8, opacity * 0.72);
    sprite.userData.aura.scale.setScalar(baseScale * (4.2 + Math.sin(t * 1.6) * 0.42));
  });
}

function currentVectorAt(position, elapsed, index) {
  const ribbon = Math.sin(position.z * 0.26 + elapsed * 0.52 + index * 0.71);
  const eddy = Math.cos(position.x * 0.42 - elapsed * 0.38 + position.z * 0.08);
  return new THREE.Vector3(
    ribbon * 0.34,
    Math.sin(elapsed * 0.7 + index) * 0.06,
    eddy * 0.28,
  );
}

function makeMarineSnow() {
  const count = 460;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = -18 + Math.random() * 36;
    positions[i * 3 + 1] = -11 + Math.random() * 10;
    positions[i * 3 + 2] = -27 + Math.random() * 54;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd8ffff,
    size: 0.045,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  return points;
}

function animateMarineSnow(points, camera, elapsed) {
  const underwater = camera.position.y < 0.3;
  points.visible = underwater;
  if (!underwater) return;

  const positions = points.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const drift = Math.sin(elapsed * 0.35 + i * 0.19) * 0.002;
    positions.setY(i, positions.getY(i) - 0.006);
    positions.setX(i, positions.getX(i) + drift);
    if (positions.getY(i) < -11.5) {
      positions.setY(i, 0.8);
      positions.setX(i, camera.position.x - 18 + Math.random() * 36);
      positions.setZ(i, camera.position.z - 27 + Math.random() * 54);
    }
  }
  positions.needsUpdate = true;
}

function updateAtmosphere(scene, renderer, ambient, key, rim, trenchLight, camera, settings) {
  const underwater = THREE.MathUtils.smoothstep(settings.waterLevel - camera.position.y, 0, 4);
  const depthOpacity = waterOpacityForCamera(camera, settings);
  const surfaceColor = new THREE.Color(0x07131a);
  const deepColor = new THREE.Color(0x021923);
  const color = surfaceColor.clone().lerp(deepColor, underwater);
  renderer.setClearColor(color, 1);
  scene.fog.color.copy(color);
  scene.fog.density = THREE.MathUtils.lerp(0.026, 0.072 + depthOpacity * 0.045, underwater);
  ambient.intensity = THREE.MathUtils.lerp(1.7, 0.72, underwater);
  key.intensity = THREE.MathUtils.lerp(2.4, 0.65, underwater);
  rim.intensity = THREE.MathUtils.lerp(1.2, 1.9, underwater);
  trenchLight.intensity = THREE.MathUtils.lerp(0.4, 3.1, underwater);
}

function updateWaterOpacity(water, camera, settings) {
  water.material.uniforms.uOpacity.value = waterOpacityForCamera(camera, settings);
}

function waterOpacityForCamera(camera, settings) {
  const depth = Math.max(0, settings.waterLevel - camera.position.y);
  const deepest = Math.max(1, effectiveTrenchDepth(settings));
  const depthT = THREE.MathUtils.smoothstep(depth, 0.4, deepest);
  return THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.24, 0.8, depthT), 0.24, 0.8);
}

function updateTerrain(mesh, settings) {
  const positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, elevationAt(x, z, settings) * settings.verticalExaggeration);
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function colorTerrain(geometry, settings) {
  const positions = geometry.attributes.position;
  const colors = [];
  const heatCold = new THREE.Color(0x11355c);
  const heatHot = new THREE.Color(0xff6f35);
  const ageYoung = new THREE.Color(0x42e8d3);
  const ageOld = new THREE.Color(0x7f74ff);

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = positions.getY(i);
    let color = new THREE.Color();

    if (settings.layer === 'heat') {
      color.lerpColors(heatCold, heatHot, heatFlowAt(x, z, settings) / 2);
    } else if (settings.layer === 'age') {
      const stripe = settings.ageStripes ? Math.sin((x + 18) * 2.2) * 0.08 : 0;
      color.lerpColors(ageYoung, ageOld, THREE.MathUtils.clamp(plateAgeAt(x) / 190 + stripe, 0, 1));
    } else {
      color = bathymetryColorForY(y, settings);
    }

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function bathymetryColorForY(y, settings) {
  const deepestY = -settings.trenchDepth * settings.verticalExaggeration;
  const surfaceY = 2.5 * settings.verticalExaggeration;
  const t = THREE.MathUtils.clamp((y - deepestY) / (surfaceY - deepestY), 0, 1);
  const color = colorFromStops(bathymetryStops, t);
  const deepening = THREE.MathUtils.smoothstep(-y, settings.trenchDepth * settings.verticalExaggeration * 0.58, settings.trenchDepth * settings.verticalExaggeration);
  const depthBoost = THREE.MathUtils.clamp((settings.trenchDepth - 4.5) / 4.5, 0, 1);
  const abyssBlue = new THREE.Color(0x01081c);

  return color.lerp(abyssBlue, deepening * depthBoost * 0.42);
}

function colorFromStops(stops, t) {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [startStop, startColor] = stops[i];
    const [endStop, endColor] = stops[i + 1];
    if (t >= startStop && t <= endStop) {
      const localT = (t - startStop) / (endStop - startStop);
      return startColor.clone().lerp(endColor, localT);
    }
  }
  return stops[stops.length - 1][1].clone();
}

function makeWater() {
  const geometry = new THREE.PlaneGeometry(WORLD.width * 1.2, WORLD.length * 1.12, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x0a6679) },
      uColorB: { value: new THREE.Color(0x71d4d6) },
      uOpacity: { value: 0.34 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin((p.x + uTime) * 0.8) * 0.05 + cos((p.z - uTime * 0.7) * 0.55) * 0.04;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uOpacity;
      void main() {
        vec3 color = mix(uColorA, uColorB, smoothstep(0.0, 1.0, vUv.y));
        gl_FragColor = vec4(color, uOpacity);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0;
  return mesh;
}

function makeSeaFog(settings) {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(WORLD.width * 1.28, WORLD.length * 1.18, 96, 96);
  geometry.rotateX(-Math.PI / 2);

  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.2 },
        uBurnOff: { value: settings.fogBurnOff },
        uLayer: { value: i },
        uColor: { value: new THREE.Color(i < 2 ? 0xd8eef0 : 0xb7d8dc) },
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uLayer;

        void main() {
          vUv = uv;
          vec3 p = position;
          float slow = uTime * (0.08 + uLayer * 0.012);
          p.y += sin(p.x * 0.28 + slow + uLayer) * 0.035;
          p.y += cos(p.z * 0.2 - slow * 1.3) * 0.025;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uBurnOff;
        uniform float uLayer;
        uniform vec3 uColor;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 5; i++) {
            value += noise(p) * amplitude;
            p *= 2.05;
            amplitude *= 0.52;
          }
          return value;
        }

        void main() {
          vec2 wind = vec2(uTime * 0.018, -uTime * 0.011);
          vec2 shear = vec2(uLayer * 0.17, -uLayer * 0.11);
          float soft = fbm(vUv * 4.2 + wind + shear);
          float tendrils = fbm(vUv * 12.0 - wind * 2.8 + shear);
          float body = smoothstep(0.2 + uBurnOff * 0.42, 0.82, soft + tendrils * 0.38);
          float holes = smoothstep(0.48 - uBurnOff * 0.12, 0.86 - uBurnOff * 0.3, fbm(vUv * 7.0 + wind * 3.1));
          float edge = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
          edge *= smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
          float alpha = body * mix(1.0, 1.0 - holes, uBurnOff) * edge * uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    const layer = new THREE.Mesh(geometry, material);
    layer.userData = {
      layerIndex: i,
      baseOffset: i / 4,
      driftPhase: i * 0.9,
    };
    layer.renderOrder = 4 + i;
    group.add(layer);
  }

  group.visible = settings.seaFog;
  updateSeaFog(group, settings);
  return group;
}

function updateSeaFog(group, settings) {
  group.visible = settings.seaFog;
  group.children.forEach((layer) => {
    const layerT = layer.userData.baseOffset;
    const burnLift = settings.fogBurnOff * (0.08 + layerT * 0.28);
    const verticalOffset = 0.035 + layerT * settings.fogThickness + burnLift;
    const density = THREE.MathUtils.smoothstep(settings.fogThickness, 0.05, 1.35);
    const burnFade = 1 - settings.fogBurnOff * (0.66 + layerT * 0.2);
    layer.position.y = settings.waterLevel + verticalOffset;
    layer.scale.setScalar(1 + layerT * 0.08 + settings.fogThickness * 0.025);
    layer.material.uniforms.uOpacity.value = Math.max(0, density * burnFade * (0.2 - layerT * 0.026));
    layer.material.uniforms.uBurnOff.value = settings.fogBurnOff;
  });
}

function animateSeaFog(group, elapsed, settings) {
  if (!settings.seaFog) return;

  group.children.forEach((layer) => {
    layer.material.uniforms.uTime.value = elapsed;
    layer.position.x = Math.sin(elapsed * 0.035 + layer.userData.driftPhase) * (0.18 + layer.userData.baseOffset * 0.14);
    layer.position.z = Math.cos(elapsed * 0.028 + layer.userData.driftPhase) * (0.16 + layer.userData.baseOffset * 0.1);
  });
}

function makeSlab(settings) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x48616b,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  updateSlab(mesh, settings);
  return mesh;
}

function updateSlab(mesh, settings) {
  const vertices = [];
  const indices = [];
  const rows = 18;
  const cols = 28;
  for (let r = 0; r <= rows; r += 1) {
    const z = THREE.MathUtils.lerp(-WORLD.length * 0.43, WORLD.length * 0.43, r / rows);
    for (let c = 0; c <= cols; c += 1) {
      const d = c / cols;
      const x = basinCenterX(z) + d * 23;
      const dip = Math.tan(THREE.MathUtils.degToRad(settings.slabDip));
      const terrainY = elevationAt(x, z, settings) * settings.verticalExaggeration;
      const bend = Math.sin(z * 0.35) * 0.08;
      const y = terrainY - 0.55 - d * dip * 7.4 * settings.verticalExaggeration + bend;
      vertices.push(x, y, z);
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = r * (cols + 1) + c;
      indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  mesh.geometry.setIndex(indices);
  mesh.geometry.computeVertexNormals();
}

function makeQuakes() {
  const group = new THREE.Group();
  makeQuakeCatalog().forEach((quake) => {
    const radius = THREE.MathUtils.mapLinear(quake.magnitude, 3, 7, 0.08, 0.38);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 14, 10),
      new THREE.MeshBasicMaterial({ color: quake.magnitude > 5.5 ? 0xffc857 : 0xff4f7b, transparent: true, opacity: 0.8 }),
    );
    mesh.position.set(quake.x, quake.y, quake.z);
    mesh.userData.baseScale = 0.7 + quake.magnitude * 0.12;
    group.add(mesh);
  });
  return group;
}

function animateQuakes(group, elapsed) {
  group.children.forEach((mesh, i) => {
    const pulse = 1 + Math.sin(elapsed * 3.2 + i * 0.6) * 0.18;
    mesh.scale.setScalar(mesh.userData.baseScale * pulse);
    mesh.material.opacity = 0.5 + Math.sin(elapsed * 2.4 + i) * 0.2;
  });
}

function makeVectors(settings) {
  const group = new THREE.Group();
  updateVectors(group, settings);
  return group;
}

function updateVectors(group, settings) {
  group.clear();
  const vectorCount = 7;
  for (let i = 0; i < vectorCount; i += 1) {
    const z = THREE.MathUtils.lerp(-20, 20, i / (vectorCount - 1));
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, -0.18, 0).normalize(),
      new THREE.Vector3(-18, 1.6, z),
      settings.convergence * 0.055,
      0x8df7ff,
      0.9,
      0.48,
    );
    arrow.userData.basePosition = arrow.position.clone();
    arrow.userData.baseLength = settings.convergence * 0.055;
    arrow.userData.phase = i * 0.65;
    group.add(arrow);
  }
}

function animateVectors(group, elapsed, settings) {
  group.children.forEach((arrow, index) => {
    const pulse = Math.sin(elapsed * 0.28 + arrow.userData.phase) * 0.04;
    arrow.position.copy(arrow.userData.basePosition);
    arrow.position.x += pulse * 0.18;
    arrow.position.y += pulse * -0.03;
    arrow.position.z += Math.sin(elapsed * 0.22 + index) * 0.035;
    arrow.setLength(settings.convergence * 0.055 * (1 + pulse), 0.9, 0.48);
  });
}

function makeCurrents() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x1c8a93,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  for (let i = 0; i < 23; i += 1) {
    const z = -20 + i * 1.78;
    const y = -1.35 - (i % 6) * 0.54;
    const width = 4.8 + (i % 5) * 0.72;
    const positions = [];

    for (let p = 0; p < 54; p += 1) {
      const t = p / 53;
      const wave = Math.sin(t * Math.PI * 2.7 + i * 0.74);
      const x = basinCenterX(z) - width + t * width * 2 + wave * 0.5;
      positions.push(x, y + Math.sin(t * Math.PI + i) * 0.2, z + wave * 0.92);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, material.clone());
    line.userData = {
      phase: i * 0.47,
      baseOpacity: 0.16 + (i % 5) * 0.022,
      basePositions: Float32Array.from(positions),
      speed: 1.15 + (i % 6) * 0.13,
    };
    group.add(line);
  }

  return group;
}

function animateCurrents(group, elapsed) {
  group.children.forEach((line, index) => {
    const phase = elapsed * line.userData.speed + line.userData.phase;
    const positions = line.geometry.attributes.position;
    const base = line.userData.basePositions;

    for (let i = 0; i < positions.count; i += 1) {
      const offset = i * 3;
      const wave = Math.sin(phase + i * 0.34 + index * 0.19);
      positions.setX(i, base[offset] + wave * 0.16);
      positions.setY(i, base[offset + 1] + Math.cos(phase * 0.8 + i * 0.22) * 0.045);
      positions.setZ(i, base[offset + 2] + wave * 0.28);
    }

    positions.needsUpdate = true;
    line.position.x = Math.sin(phase * 0.7) * 0.12;
    line.material.opacity = line.userData.baseOpacity + Math.sin(phase + index) * 0.045;
  });
}

function makeThermoclineAcoustics() {
  const group = new THREE.Group();
  const layerMaterial = new THREE.MeshBasicMaterial({
    color: 0x173a52,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const channelMaterial = new THREE.MeshBasicMaterial({
    color: 0x3e5f9e,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x050914,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const thermocline = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.width * 0.86, WORLD.length * 0.7, 1, 1), layerMaterial);
  thermocline.rotation.x = -Math.PI / 2;
  thermocline.position.set(basinCenterX(WORLD.basinZ), -1.05, WORLD.basinZ);
  thermocline.userData = { kind: 'thermocline', baseOpacity: 0.2 };
  group.add(thermocline);

  const soundChannel = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.width * 0.72, WORLD.length * 0.58, 1, 1), channelMaterial);
  soundChannel.rotation.x = -Math.PI / 2;
  soundChannel.position.set(basinCenterX(WORLD.basinZ), -3.35, WORLD.basinZ);
  soundChannel.userData = { kind: 'soundChannel', baseOpacity: 0.16 };
  group.add(soundChannel);

  const shadowZone = new THREE.Mesh(new THREE.PlaneGeometry(10.5, WORLD.length * 0.46, 1, 1), shadowMaterial);
  shadowZone.rotation.x = -Math.PI / 2;
  shadowZone.position.set(basinCenterX(WORLD.basinZ) + 4.7, -2.15, WORLD.basinZ + 1);
  shadowZone.userData = { kind: 'shadowZone', baseOpacity: 0.24 };
  group.add(shadowZone);

  const rayMaterial = new THREE.LineBasicMaterial({
    color: 0xa7f4ff,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  for (let i = 0; i < 7; i += 1) {
    const z = -15 + i * 5;
    const points = [];
    for (let p = 0; p < 64; p += 1) {
      const t = p / 63;
      const x = basinCenterX(WORLD.basinZ) - 8.5 + t * 17;
      const bend = Math.sin(t * Math.PI * 1.75 + i * 0.48);
      const y = -0.82 - t * 3.2 + bend * 0.72 + Math.sin(t * Math.PI) * 0.45;
      points.push(new THREE.Vector3(x, y, z + bend * 1.1));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const ray = new THREE.Line(geometry, rayMaterial.clone());
    ray.userData = { kind: 'ray', phase: i * 0.64, baseOpacity: 0.34 + i * 0.035 };
    group.add(ray);
  }

  return group;
}

function animateThermoclineAcoustics(group, elapsed) {
  group.children.forEach((object, index) => {
    const pulse = Math.sin(elapsed * 0.6 + index * 0.7) * 0.5 + 0.5;
    if (object.userData.kind === 'ray') {
      object.material.opacity = object.userData.baseOpacity + pulse * 0.2;
      object.position.x = Math.sin(elapsed * 0.18 + index) * 0.18;
    } else {
      object.material.opacity = object.userData.baseOpacity + pulse * 0.04;
    }
  });
}

function makePlumes() {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i += 1) {
    const geometry = new THREE.ConeGeometry(0.6 + i * 0.02, 5.5 + Math.sin(i) * 0.8, 18, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: i % 2 ? 0xffa24a : 0xff5656,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plume = new THREE.Mesh(geometry, material);
    plume.position.set(WORLD.arcX + Math.sin(i * 1.9) * 1.7, 1.6, -18 + i * 4.5);
    plume.userData.phase = i * 0.7;
    group.add(plume);
  }
  return group;
}

function animatePlumes(group, elapsed) {
  group.children.forEach((plume) => {
    const s = 1 + Math.sin(elapsed * 1.6 + plume.userData.phase) * 0.09;
    plume.scale.set(s, 1 + (s - 1) * 2, s);
    plume.rotation.y += 0.003;
  });
}

function updateMetrics(settings, hud) {
  hud.depth.textContent = `${effectiveTrenchDepth(settings).toFixed(1)} km`;
  hud.convergence.textContent = `${Math.round(settings.convergence)} mm/yr`;
  hud.age.textContent = `${Math.round(plateAgeAt(-18) - plateAgeAt(14))} Myr`;
}
