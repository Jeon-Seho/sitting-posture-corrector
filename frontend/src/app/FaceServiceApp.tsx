import { useEffect, useState } from 'react'
import { LocalServiceApp } from './LocalServiceApp'
import { useServiceFaceCamera } from '../features/face-lab/useServiceFaceCamera'
import FaceLabApp from '../features/face-lab/FaceLabApp'
function LocalFaceApp() {
  const camera=useServiceFaceCamera()
  return <LocalServiceApp camera={camera}/>
}
export default function FaceServiceApp() {
  const [collection,setCollection]=useState(location.hash==='#collection')
  useEffect(()=>{const changed=()=>setCollection(location.hash==='#collection');window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  if(collection)return <><button className="btn" onClick={()=>{location.hash=''}}>POSEGOOD으로 돌아가기</button><FaceLabApp/></>
  return <LocalFaceApp/>
}
