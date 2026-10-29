import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {launchChrome} from '../../tools/browser/chrome.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=root+'.cache/design-review'; await mkdir(dir,{recursive:true});
const profile=await mkdtemp(dir+'/flat-icons-');
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const b=await launchChrome({executable:'C:/Program Files/Google/Chrome/Application/chrome.exe',port,profile,artifactFolder:dir});
try {
 await b.cdp.call('Page.navigate',{url:'about:blank'});
 const manifest=JSON.parse(await readFile(root+'frontend/assets/icons/icon-manifest.json','utf8'));
 const source=(await readFile(root+'frontend/assets/icons/'+manifest.source)).toString('base64');
 const names=manifest.icons;
 const images=await b.cdp.evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${source}';await image.decode(); const output=[];for(let i=0;i<${names.length};i++){const c=document.createElement('canvas');c.width=c.height=${manifest.outputSize};const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,${manifest.crop.x}+(i%${manifest.columns})*${manifest.crop.stepX},${manifest.crop.y}+Math.floor(i/${manifest.columns})*${manifest.crop.stepY},${manifest.crop.width},${manifest.crop.height},0,0,${manifest.outputSize},${manifest.outputSize});output.push(c.toDataURL('image/png').split(',')[1]);}return output})()`);
 for(let i=0;i<names.length;i++){const id=names[i].replace(/(?<!^)(?=[A-Z])/g,'-').toLowerCase();await writeFile(root+'frontend/public/icons/'+id+'.png',Buffer.from(images[i],'base64'));}
 console.log('Extracted the unified PNG icon set from the active image-model sheet');
} finally {await b.stop()}
