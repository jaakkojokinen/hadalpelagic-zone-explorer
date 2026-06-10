# Convergent Margin Explorer

An explorable browser app about oceanic trench formation. The scene uses Vite,
Three.js, lil-gui, vanilla JS modules, and CSS/HTML overlays.

## Run

```sh
npm install
npm run dev
```

Then open the Vite URL, usually `http://127.0.0.1:5173`.

## Current Layers

- Bathymetry: procedural seafloor elevation with a roundish 7 km basin, outer rise,
  accretionary wedge, forearc, and volcanic arc.
- Heat flow: color layer highlighting cold slab/basin regions and warm arc
  anomalies.
- Oceanic plate age: stripe layer showing older lithosphere approaching the
  subduction zone.
- Earthquakes: animated Wadati-Benioff zone hypocenters sized by magnitude.
- Plate vectors: convergence arrows controlled by the GUI.
- Heat plumes: animated volcanic arc plume markers.

## Future Ideas

- 3D sequence: escape the rat race, land in the bow of a Somali pirate speedboat,
  and lead the charge for an entire fleet.
