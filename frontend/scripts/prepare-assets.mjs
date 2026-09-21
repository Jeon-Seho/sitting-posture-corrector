import { mkdir, cp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const destination = new URL('public/mediapipe/', root);
await mkdir(destination, { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm', root), new URL('wasm', destination), { recursive: true });
const metadata = JSON.parse(await readFile(new URL('model-asset.json', root), 'utf8'));
if (!/^pose_landmarker_[a-z]+\.task$/.test(metadata.filename)) throw new Error('Invalid model filename');
const model = new URL(metadata.filename, destination);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const existing = await readFile(model);
  if (hash(existing) === metadata.sha256) { console.log('MediaPipe assets ready (verified SHA-256).'); process.exit(0); }
} catch { /* Download absent or invalid model. */ }
console.log('Downloading official Pose Landmarker Heavy model...');
const response = await fetch(metadata.url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (hash(bytes) !== metadata.sha256) throw new Error('Model checksum mismatch; download not installed.');
const temporary = fileURLToPath(model) + '.partial';
try { await writeFile(temporary, bytes); await rename(temporary, model); }
finally { await rm(temporary, { force: true }); }
console.log('MediaPipe assets ready (verified SHA-256).');
