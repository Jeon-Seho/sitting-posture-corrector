import { mkdir, cp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Optional /dev comparison assets. Normal dev/build prepares Heavy and Full only.
const root = new URL('../', import.meta.url);
const destination = new URL('public/mediapipe/', root);
const variants = JSON.parse(await readFile(new URL('model-variants.json', root), 'utf8'));
const primary = JSON.parse(await readFile(new URL('model-asset.json', root), 'utf8'));
for (const key of ['filename', 'modelId', 'url', 'sha256']) {
  if (variants.heavy[key] !== primary[key]) throw new Error(`Default Heavy model mismatch: ${key}`);
}
await mkdir(destination, { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm', root), new URL('wasm', destination), { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const variant of ['lite', 'full', 'heavy']) {
  const metadata = variants[variant];
  const expectedUrl = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
  if (metadata.filename !== `pose_landmarker_${variant}.task` || metadata.url !== expectedUrl
    || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error(`Invalid model metadata: ${variant}`);
  const model = new URL(metadata.filename, destination);
  try {
    if (hash(await readFile(model)) === metadata.sha256) {
      console.log(`${variant}: ready (verified SHA-256).`);
      continue;
    }
  } catch { /* Download absent or invalid model. */ }
  console.log(`Downloading official MediaPipe ${variant} v1...`);
  const response = await fetch(metadata.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== metadata.sha256) throw new Error(`${variant}: checksum mismatch; not installed.`);
  const temporary = fileURLToPath(model) + '.partial';
  try { await writeFile(temporary, bytes); await rename(temporary, model); }
  finally { await rm(temporary, { force: true }); }
  console.log(`${variant}: ready (verified SHA-256).`);
}
