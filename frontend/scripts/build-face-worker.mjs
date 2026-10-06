// MediaPipe's WASM loader needs classic-script globals (ModuleFactory).
// A bundled classic worker supports both Vite dev and packaged Electron without eval.
import {build} from 'rolldown';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await build({input:fileURLToPath(new URL('src/features/face-lab/detector.worker.ts',root)),output:{file:fileURLToPath(new URL('public/face-detector.js',root)),format:'iife',minify:true}});
console.log('Classic face worker bundled.');
