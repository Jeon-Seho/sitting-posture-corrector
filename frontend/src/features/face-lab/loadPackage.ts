import { validateFaceModel } from '../../../../model/prototype/faceMotion'
import type { FaceBuild } from './evaluation'
export async function loadFacePackage() {
  const [modelResponse,buildResponse]=await Promise.all([fetch('/face-model.json'),fetch('/face-build.json')])
  if(!modelResponse.ok||!buildResponse.ok)throw Error('얼굴 모델 또는 버전 정보가 없습니다. 앱을 다시 패키징해 주세요.')
  const bytes=await modelResponse.arrayBuffer(),build:FaceBuild=await buildResponse.json()
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('')
  const model=validateFaceModel(JSON.parse(new TextDecoder().decode(bytes)))
  if(sha!==build.modelSha256||model.synthetic!==build.synthetic||model.version!==build.modelSchema)throw Error('패키지의 얼굴 모델과 버전 정보가 일치하지 않습니다.')
  return {model,build}
}
