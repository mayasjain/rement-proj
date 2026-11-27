# Industrial asset authoring

## Assets and provenance

- `public/models/hopper.glb` uses Innerscene’s **Hopper with feeder**, published under CC0 1.0. The browser edition keeps the geometry and material assignments and reduces the resolution of the embedded textures. [Original model and license](https://www.innerscene.com/tools/library/3d-parts/hopper-with-feeder-71c6d1ce)
- `public/models/industrial.glb` contains original, project-authored meshes for the jaw crusher, its three subassemblies, screen, washer, gravel conveyor, transfer belts, and two storage variants. The geometry is designed to match the demonstration’s equipment envelope, connection points, and selection hierarchy.
- Library research also covered an industrial crusher distributed as a merged mesh and community CAD generally intended for private use. Named component geometry and public redistribution were criteria for inclusion. [Merged crusher listing](https://www.fab.com/listings/2aa4e0c9-a6e0-4582-b74d-df3b247b0142) · [GrabCAD reuse guidance](https://help.grabcad.com/article/246-how-can-models-be-used-and-shared)

## Generate the GLBs

From the repository root, after installing the frontend dependencies:

```sh
node app/frontend/tools/build-models.mjs
node --experimental-strip-types --test app/frontend/tools/visual-factory.test.mjs
```

Download the original hopper from its asset page. On macOS, regenerate the reduced texture edition with:

```sh
python3 app/frontend/tools/optimize-hopper.py /path/to/hopper-with-feeder.glb app/frontend/public/models/hopper.glb
```

The CadQuery prototype exported STEP and GLB files for a parametric bearing assembly with drilled holes and named parts. The headless Blender Python prototype exported a GLB with named parts, beveled geometry, and metallic and roughness materials. The shipped assemblies use the Node generator so assets can be regenerated with the existing frontend dependencies. [CadQuery assembly export](https://github.com/CadQuery/cadquery/blob/master/doc/importexport.rst#exporting-assemblies-to-gltf) · [Blender Python background mode](https://docs.blender.org/api/main/info_tips_and_tricks.html#use-blender-without-its-user-interface) · [Blender glTF exporter](https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html)

## Fit and performance

YAML controls dimensions, position, rotation, and component pivots in meters. The two GLBs use normalized envelopes and their runtime transforms derive from those definitions. Transfer mounts and explosion offsets are visualization metadata. The engine supplies achievable stream and equipment flow. The render layer represents throughput with bounded instanced aggregate markers at a target of 30 updates per second.

Each authored assembly batches meshes by material. The two GLBs total about 1.12 MB. Shadow maps are refreshed when the equipment layout changes. With flow paused or at zero, the canvas renders on demand. Motion starts paused for people who prefer reduced motion.

Chromium on an Apple M2 using Metal measured 30.2 rendered frames per second at a 1.25× Retina render scale with 2× CPU throttling. The 95th-percentile frame interval was 34.4 ms. An M1 device was unavailable for a direct benchmark.
