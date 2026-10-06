import {readFile} from 'node:fs/promises';
const m=JSON.parse(await readFile(new URL('../public/face-model.json',import.meta.url),'utf8'));
if(m.version!==2||m.frames!==40||m.features?.length!==26||!m.probe||!m.weights)throw Error('Run train_face_motion.py before packaging.');
console.log('Face temporal model is present; PyTorch/JS parity is verified by the face-lab tests.');
