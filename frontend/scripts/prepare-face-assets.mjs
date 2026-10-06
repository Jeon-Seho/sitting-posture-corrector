import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const meta=JSON.parse(await readFile(new URL('face-model-asset.json',root),'utf8'));
if(meta.filename!=='face_landmarker.task')throw Error('Invalid face asset');
const dir=new URL('public/mediapipe/',root),path=new URL(meta.filename,dir);
await mkdir(dir,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
try{if(hash(await readFile(path))===meta.sha256){console.log('Face asset SHA-256 verified.');process.exit(0)}}catch{}
const response=await fetch(meta.url,{signal:AbortSignal.timeout(120000)});
if(!response.ok)throw Error(`Face model download: ${response.status}`);
const bytes=Buffer.from(await response.arrayBuffer());
if(hash(bytes)!==meta.sha256)throw Error('Face checksum mismatch');
const temp=new URL(meta.filename+'.partial',dir);
try{await writeFile(temp,bytes);await rename(temp,path)}finally{await rm(temp,{force:true})}
console.log('Face asset SHA-256 verified.');
