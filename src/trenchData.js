import * as THREE from 'three';

export const WORLD = {
  width: 42,
  length: 54,
  terrainSegments: 180,
  trenchX: -4.5,
  basinZ: -4,
  forearcX: 4.5,
  arcX: 13,
};

export function elevationAt(x, z, settings) {
  const centerX = basinCenterX(z);
  const radiusX = 10.8 + ridgeNoise(z * 0.11) * 0.62;
  const radiusZ = 19.6 + ridgeNoise(x * 0.09 + 2.4) * 1.05;
  const dx = x - centerX;
  const dz = z - WORLD.basinZ;
  const radial = Math.hypot(dx / radiusX, dz / radiusZ);
  const basinMask = 1 - THREE.MathUtils.smoothstep(radial, 0.2, 1.16);
  const innerFloor = 1 - THREE.MathUtils.smoothstep(radial, 0.14, 0.56);
  const rimRoughness = Math.exp(-((radial - 0.96) ** 2) / 0.07);
  const terrace = Math.sin(radial * 16 + ridgeNoise(z * 0.17) * 1.2) * 0.18 * basinMask * (1 - innerFloor * 0.55);
  const scallopedWall = (0.24 * Math.sin(z * 0.48 + x * 0.22) + 0.14 * Math.sin(z * 0.91 - x * 0.37)) * basinMask * (1 - innerFloor);
  const floorTexture = (0.18 * ridgeNoise(x * 0.52 + z * 0.29) + 0.08 * Math.sin(z * 1.4)) * innerFloor;
  const outerRise = 1.05 * Math.exp(-((x + 11.5) ** 2) / 18);
  const accretionWedge = 2.2 * Math.exp(-((x - 1.5) ** 2) / 12) * (0.72 + 0.28 * ridgeNoise(z * 0.18));
  const volcanicArc = 4.6 * Math.exp(-((x - WORLD.arcX) ** 2) / 7) * (0.86 + 0.14 * ridgeNoise(z * 0.3));
  const abyssalRoughness = 0.22 * Math.sin(z * 0.65 + x * 0.18) + 0.16 * Math.sin(z * 1.2 - x * 0.31);
  const slabSlope = x > WORLD.trenchX ? -0.09 * (x - WORLD.trenchX) * settings.slabDip * 0.025 : 0;
  const base = outerRise + accretionWedge + volcanicArc + abyssalRoughness + slabSlope - 1.05;
  const basinFloor = -settings.trenchDepth + 0.26 + floorTexture;
  const carvedBasin = THREE.MathUtils.lerp(base, basinFloor, basinMask);
  const rimLift = 0.58 * rimRoughness * (0.7 + 0.3 * ridgeNoise(z * 0.31 + x * 0.08));

  return Math.max(-settings.trenchDepth, carvedBasin + terrace + scallopedWall + rimLift);
}

export function plateAgeAt(x) {
  return THREE.MathUtils.clamp(18 + (-x + 18) * 4.4, 0, 190);
}

export function heatFlowAt(x, z, settings) {
  const arcHeat = 1.6 * Math.exp(-((x - WORLD.arcX) ** 2) / 16);
  const dx = x - basinCenterX(z);
  const dz = z - WORLD.basinZ;
  const trenchCold = -0.7 * Math.exp(-(dx ** 2) / 36 - (dz ** 2) / 310);
  const ridge = 0.35 * Math.sin(z * 0.42 + x * 0.15);
  return THREE.MathUtils.clamp(0.38 + arcHeat + trenchCold + ridge * settings.thermalVents, 0, 2);
}

export function basinCenterX(z) {
  return WORLD.trenchX + Math.sin(z * 0.12) * 0.8 + Math.sin(z * 0.31 + 1.7) * 0.38;
}

export function makeQuakeCatalog(count = 90) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / Math.max(1, count - 1);
    const z = THREE.MathUtils.lerp(-WORLD.length * 0.44, WORLD.length * 0.44, t);
    const downDip = Math.pow((i % 17) / 16, 1.25);
    const x = basinCenterX(z) + downDip * 17 + Math.sin(i * 2.03) * 1.25;
    const y = -0.2 - downDip * 5.4 + Math.sin(i * 1.7) * 0.35;
    const magnitude = 3.2 + downDip * 3.4 + ((i * 37) % 11) * 0.06;
    return { x, y, z: z + Math.sin(i * 0.81) * 4, magnitude };
  });
}

export function ridgeNoise(v) {
  return Math.sin(v) * 0.55 + Math.sin(v * 2.13 + 1.2) * 0.28 + Math.sin(v * 4.7) * 0.17;
}
