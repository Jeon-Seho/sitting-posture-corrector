// GP-0125: deliver the model lab and POSEGOOD app as one versioned test pair.
import { readFile, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root=new URL('../',import.meta.url)
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'))
const lock=JSON.parse(await readFile(new URL('package-lock.json',root),'utf8'))
if(pkg.version!==lock.version||pkg.version!==lock.packages[''].version)throw Error('App and lock versions differ')
const modelHash=createHash('sha256').update(await readFile(new URL('public/face-model.json',root))).digest('hex')
const previous=await readFile(new URL('release-portable/test-pair.json',root),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e})
if(previous&&previous.appVersion===pkg.version&&previous.modelSha256!==modelHash)throw Error('The model changed; increase the test app version before packaging')
if(process.argv.includes('--before')){console.log(`Test version ${pkg.version} / model ${modelHash.slice(0,12)}`);process.exit(0)}
const lab=JSON.parse(await readFile(new URL('dist-face/face-build.json',root),'utf8'))
const app=JSON.parse(await readFile(new URL('dist/face-build.json',root),'utf8'))
if(lab.appVersion!==pkg.version||app.appVersion!==pkg.version||lab.modelSha256!==modelHash||app.modelSha256!==modelHash)throw Error('Model lab and POSEGOOD versions/models differ; rebuild both')
const files=[`release-face/PoseGood-Face-Lab-${pkg.version}.exe`,'PoseGood.exe','release/win-unpacked/PoseGood.exe','release-portable/PoseGood.exe']
await Promise.all(files.map(path=>access(new URL(path,root))))
const manifest={testVersion:`test_${pkg.version}`,appVersion:pkg.version,modelSha256:modelHash,synthetic:app.synthetic,labBuild:lab,posegoodBuild:app,files}
await writeFile(new URL('release-portable/test-pair.json',root),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({testVersion:manifest.testVersion,modelSha256:modelHash,files},null,2))
