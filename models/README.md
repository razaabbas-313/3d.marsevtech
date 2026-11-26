# Models folder

Put your `.glb` (binary glTF 2.0) furniture models in this folder.

## Included sample models

These seven files are the real furniture models used by the default and Habitt demo pitches. They demonstrate the experience only and are not any client's products.

| File | Piece | Size | Real-world size | Recolor |
|---|---|---|---|---|
| `sectional-sofa.glb` | L-shaped sectional | 195 KB | 270 × 162 × 94 cm | Upholstery (material 1) |
| `loveseat.glb` | Two-seater | 157 KB | 155 × 92 × 93 cm | Upholstery (material 1) |
| `lounge-armchair.glb` | Lounge armchair | 112 KB | 78 × 96 × 90 cm | Upholstery (material 1) |
| `coffee-table.glb` | Oval coffee table | 114 KB | 121 × 63 × 62 cm | Wood finish (material 0) |
| `double-bed.glb` | Double bed | 752 KB | 184 × 216 × 118 cm | Bedding (material 1) |
| `designer-sofa.glb` | Three-seater sofa (used in the hero) | 426 KB | unknown | none |
| `egg-lounge-chair.glb` | Egg chair with ottoman | 623 KB | unknown | none |

The last two are scanned models with a single baked texture, so recoloring would tint the whole piece; their swatches are replaced by a note. Their scale is also unknown (they were normalised to about one unit), so AR is turned off for them rather than placing a wrongly sized sofa in a room.

## Optimization that was actually applied

`designer-sofa.glb` (from 4.74 MB) and `egg-lounge-chair.glb` (from 7.75 MB) were rebuilt from the originals with glTF-Transform: `weld`, `simplify` (to about 31k and 34k triangles), `quantize`, WebP texture recompression and **Meshopt** compression. Meshopt was verified: both files load and render identically in model-viewer 3.5.0 once `ModelViewerElement.meshoptDecoderLocation` is set, which `app.js` does. The pinned decoder is fetched from jsDelivr only when one of these files loads. Draco was **not** used.

Because Meshopt and WebP textures are not guaranteed to work in Android Scene Viewer (not tested on a device), these two models have `"ar": false`. Keep AR models as plain, uncompressed-geometry GLBs with JPEG/PNG textures. The other five files are used exactly as downloaded: they are small (112-752 KB), and quantizing them would save only 12-20% for no visible benefit.

The full audit table and the commands are in the main `README.md`.

## Reference a model in JSON

In `pitches/<client>.json`, set the product's `src` relative to the site root:

```json
{
  "id": "oslo-sofa",
  "title": "Oslo Three-Seater Sofa",
  "src": "models/oslo-sofa.glb"
}
```

Only models listed in the active pitch are ever requested, and only when their card is near the screen. Other files in this folder are never downloaded.

Use lowercase file names with hyphens and no spaces. On GitHub Pages and Linux hosts, `Sofa.GLB` and `sofa.glb` are different files.

## Size and compression

- Aim for **3 MB or less per model**. Smaller loads faster on mobile data.
- Mesh compression is optional and only for models that do **not** need AR. This project is set up for **Meshopt** (`npx @gltf-transform/cli meshopt in.glb out.glb --level high`); model-viewer also decodes Draco, but its decoder is much larger. Always test the compressed file in the browser before adopting it.
- For models that need AR, keep plain geometry and JPEG/PNG textures (Android Scene Viewer is not guaranteed to support Meshopt or WebP textures, and this was not tested on a device).
- Prefer simplifying (`simplify`) and quantizing (`quantize`) first; they need no decoder at all.

## Preparing models for mobile

- Keep meshes around 50,000 triangles or fewer. Bake fine detail into textures instead of geometry.
- Resize textures to 1024 px (2048 px for hero pieces at most). Use WebP only for non-AR models; use JPEG/PNG for AR models.
- Use real-world scale (1 unit = 1 meter) so AR places the piece at its true size. Put the origin at the center of the floor contact area.
- Face the front of the piece toward +Z.
- Use few materials (1 to 4 per model). Fewer materials load faster and make the color switcher predictable.
- Check the result in <https://modelviewer.dev/editor/> before adding it.

## Color switching

The swatches change the **base color factor** of one material. They do not swap textures. Give the fabric or wood you want to recolor its own material. If that material has a base color texture, the swatch tints the texture by multiplication, so a light or neutral texture works best.

Use `materialIndex` in the product's JSON when that material is not the first one (`0`). An out-of-range index falls back to `0`.

Set `"materialIndex": 1` or a list such as `[1, 3]` to recolor several materials together. Out-of-range indices are ignored, and if none are valid the swatches are disabled. Use `"colorLabel"` to say what changes ("Upholstery"), `"colorNote"` to explain a model that cannot be recolored, and an optional `"swatch": "#8a5a3c"` per color when the material is textured and the raw factor would not look like the result.

To find a model's materials, run `npx @gltf-transform/cli inspect model.glb`, or paint one material at a time in the browser console with `viewer.model.materials[i].pbrMetallicRoughness.setBaseColorFactor([1,0,0.8,1])`.
