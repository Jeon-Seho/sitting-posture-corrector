import { mkdir, cp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';

const root = new URL('../', import.meta.url);
const destination = new URL('public/mediapipe/', root);
await mkdir(destination, { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm', root), new URL('wasm', destination), { recursive: true });
const primary = JSON.parse(await readFile(new URL('model-asset.json', root), 'utf8'));
const variants = JSON.parse(await readFile(new URL('model-variants.json', root), 'utf8'));
const face = JSON.parse(await readFile(new URL('face-model-asset.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Service retains Heavy; /dev's measured default uses Full. Lite is opt-in via
// prepare-benchmark-assets.mjs, so normal setup does not need every comparison model.
for (const metadata of [primary, variants.full, face]) {
  const officialFaceUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  if ((!/^pose_landmarker_(heavy|full)\.task$/.test(metadata.filename) && !(metadata.filename === 'face_landmarker.task' && metadata.url === officialFaceUrl)) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error('Invalid model metadata');
  const model = new URL(metadata.filename, destination);
  try {
    const existing = await readFile(model);
    if (hash(existing) === metadata.sha256) continue;
  } catch { /* Download absent or invalid model. */ }
  console.log(`Downloading official MediaPipe model: ${metadata.filename}...`);
  const response = await fetch(metadata.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== metadata.sha256) throw new Error('Model checksum mismatch; download not installed.');
  const temporary = fileURLToPath(model) + '.partial';
  try { await writeFile(temporary, bytes); await rename(temporary, model); }
  finally { await rm(temporary, { force: true }); }
}
// The SDK's Wasm loader sets ModuleFactory through a classic script. In a
// module worker its dynamic-import fallback keeps that factory module-local.
// Bundle the developer-only worker as IIFE so importScripts uses the local loader.
await build({ configFile: false, root: fileURLToPath(root), publicDir: false, logLevel: 'error',
  build: { outDir: fileURLToPath(destination), emptyOutDir: false, sourcemap: false,
    lib: { entry: fileURLToPath(new URL('src/features/developer/face/face.worker.ts', root)), name: 'PostureFaceWorker', formats: ['iife'], fileName: () => 'face-worker.js' } } });
console.log('MediaPipe assets ready (verified SHA-256).');
