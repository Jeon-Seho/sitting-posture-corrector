"""GP-0125: two-head causal temporal CNN; generated initialization is NOT human accuracy."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import torch
from torch import nn
from face_motion_data import FEATURES, POSTURES, ACTIVITIES, load_manifest


def generated(seed, posture, activity, stress=False):
    rng = np.random.default_rng(seed)
    t = np.arange(40) / 10
    jitter = .016 if not stress else .035
    # Independent nuisance variation: camera translation, face/shoulder scale, sensor noise.
    amplitude = rng.uniform(.75,1.25)
    yaw = rng.normal(0,.04,40)+rng.uniform(-.15,.15)
    pitch = rng.normal(0,.025,40)+rng.uniform(-.12,.12)
    roll = rng.normal(0,.025,40)+rng.uniform(-.08,.08)
    scale = rng.normal(0,.03,40); gap = rng.normal(0,.025,40); offset = rng.normal(0,.025,40)
    shoulder_roll = rng.normal(0,.015,40); shoulder_scale = rng.normal(0,.02,40)
    onset = rng.uniform(-1,1.5)
    ramp = np.clip((t-onset)/rng.uniform(.4,1),0,1)*amplitude
    if posture == 1: gap -= ramp*rng.uniform(.2,.4); scale += ramp*rng.uniform(.13,.28); pitch += ramp*rng.uniform(.06,.18)
    if posture == 2: gap += ramp*rng.uniform(.22,.45); scale -= ramp*rng.uniform(.01,.1); pitch += ramp*rng.uniform(.03,.18)
    if posture == 3: roll += ramp*rng.uniform(.28,.5)*rng.choice([-1,1])
    phase = rng.uniform(0,math.pi*2); frequency = rng.uniform(.8,1.5)
    if activity == 1:
        # Include sustained left/right look and return sweeps; neutral posture is independent.
        yaw += (np.sin(t*frequency+phase) if rng.random()<.5 else ramp)*rng.uniform(.35,1.05)*rng.choice([-1,1])
    if activity == 4:
        pitch += np.sin(t*frequency+phase)*rng.uniform(.15,.45)
        roll += np.cos(t*frequency+phase)*rng.uniform(.15,.45)
    left = rng.normal(1.5,.1,40); right = rng.normal(1.5,.1,40)
    lm = np.ones(40); rm = np.ones(40)
    if activity == 3:
        left -= np.clip((t+.5)/.8,0,1)*rng.uniform(2.5,3.5)
        right -= np.clip((t+.5)/.8,0,1)*rng.uniform(2.5,3.5)
    elif rng.random()<.3:
        # One-hand gesture is a hard negative for two-hand stretching.
        left -= np.sin(t+phase)*rng.uniform(.5,1.7)
    shoulders = np.ones(40)
    if rng.random()<.4: shoulders[:]=0
    elif rng.random()<.35: shoulders[rng.integers(8,20):rng.integers(25,39)]=0
    if rng.random()<.45: lm[:]=0
    if rng.random()<.45: rm[:]=0
    gap*=shoulders; offset*=shoulders; shoulder_roll*=shoulders; shoulder_scale*=shoulders
    left*=lm; right*=rm
    # Rotation is Rz(roll) Ry(yaw) Rx(pitch), first two columns: continuous 6D.
    cy,sy,cp,sp,cr,sr=np.cos(yaw),np.sin(yaw),np.cos(pitch),np.sin(pitch),np.cos(roll),np.sin(roll)
    rotation=np.stack([cr*cy,sr*cy,-sy,cr*sy*sp-sr*cp,sr*sy*sp+cr*cp,cy*sp],1)
    rotation += rng.normal(0,jitter,rotation.shape)
    d=np.diff(rotation,axis=0,prepend=rotation[:1])*10
    dg=np.diff(gap,prepend=gap[:1])*10; dx=np.diff(offset,prepend=offset[:1])*10
    valid=shoulders*np.r_[shoulders[0],shoulders[:-1]]; dg*=valid; dx*=valid
    vx=rng.normal(0,.1,40); vy=rng.normal(0,.1,40)
    if activity==2: vx+=rng.uniform(.25,.8)*np.cos(t*.8+phase); vy+=rng.uniform(.1,.6)*np.sin(t*.8+phase)
    rows=np.column_stack([rotation,scale,gap,offset,shoulder_roll,shoulder_scale,left,right,shoulders,lm,rm,d,dg,dx,vx,vy]).astype(np.float32)
    rows[0,16:]=0
    p=posture if shoulders[-10:].min()>0 or posture in (0,3) else -100
    a=activity if activity!=3 or lm[-1] or rm[-1] else -100
    return rows,p,a


class Network(nn.Module):
    def __init__(self):
        super().__init__()
        self.convs=nn.ModuleList([nn.Conv1d(i,24,3,padding=2*d,dilation=d) for i,d in zip([26,24,24],[1,2,4])])
        self.dropout=nn.Dropout(.15)
        self.posture=nn.Linear(24,4); self.activity=nn.Linear(24,5)
    def forward(self,x):
        x=x.transpose(1,2)
        for conv,d in zip(self.convs,[1,2,4]): x=self.dropout(torch.relu(conv(x)[:,:,:-2*d]))
        x=x[:,:,-10:].mean(2)
        return self.posture(x),self.activity(x)


def metrics(logits,target,n):
    keep=target!=-100; logits,target=logits[keep],target[keep]; pred=logits.argmax(1)
    confusion=[[int(((target==i)&(pred==j)).sum()) for j in range(n)] for i in range(n)]
    f=[]
    for i in range(n):
        tp=confusion[i][i]; fp=sum(row[i] for row in confusion)-tp; fn=sum(confusion[i])-tp
        f.append(2*tp/max(1,2*tp+fp+fn))
    return dict(samples=int(keep.sum()),confusion=confusion,error_rate=float((pred!=target).float().mean()),macro_f1=sum(f)/n)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--epochs',type=int,default=400); parser.add_argument('--min-epochs',type=int,default=100)
    parser.add_argument('--patience',type=int,default=35); parser.add_argument('--takes',type=int,default=8)
    parser.add_argument('--batch-size',type=int,default=256); parser.add_argument('--manifest')
    parser.add_argument('--output',default='frontend/public/face-model.json')
    args=parser.parse_args()
    if min(args.epochs,args.min_epochs,args.patience,args.takes,args.batch_size)<1: parser.error('Positive parameters required')
    torch.manual_seed(202); torch.set_num_threads(2)
    def dataset(start,count):
        rows=[]; ps=[]; acts=[]
        for person in range(start,start+count):
            for p in range(4):
                for a in range(5):
                    for take in range(args.takes):
                        x,y,z=generated(person*100000+p*10000+a*1000+take,p,a)
                        rows.append(x); ps.append(y); acts.append(z)
        return torch.tensor(np.array(rows)),torch.tensor(ps),torch.tensor(acts)
    provenance=None
    if args.manifest:
        groups,provenance=load_manifest(args.manifest)
        datasets=[tuple(torch.tensor(np.array(v),dtype=torch.float32 if i==0 else torch.long) for i,v in enumerate(groups[r])) for r in ['train','validation','test']]
    else: datasets=[dataset(0,40),dataset(40,10),dataset(50,10)]
    train,val,test=datasets
    mean=train[0].reshape(-1,26).mean(0); scale=train[0].reshape(-1,26).std(0).clamp_min(.03)
    datasets=[((x-mean)/scale,p,a) for x,p,a in datasets]; train,val,test=datasets
    net=Network(); opt=torch.optim.AdamW(net.parameters(),lr=.002,weight_decay=.002)
    scheduler=torch.optim.lr_scheduler.ReduceLROnPlateau(opt,patience=10,factor=.5,min_lr=1e-6)
    def loss(outputs,p,a): return nn.functional.cross_entropy(outputs[0],p)+nn.functional.cross_entropy(outputs[1],a)
    def evaluate(data):
        x,p,a=data
        with torch.no_grad():
            batches=[net(batch) for batch in x.split(512)]
            outputs=tuple(torch.cat([b[i] for b in batches]) for i in range(2))
            return loss(outputs,p,a).item(),outputs
    net.eval(); initial,_=evaluate(val)
    best=float('inf'); best_state=None; best_epoch=0; stale=0; history=[]
    for epoch in range(1,args.epochs+1):
        net.train(); total=0
        for ix in torch.randperm(len(train[0])).split(args.batch_size):
            opt.zero_grad(); value=loss(net(train[0][ix]),train[1][ix],train[2][ix]); value.backward()
            nn.utils.clip_grad_norm_(net.parameters(),1); opt.step(); total+=value.item()*len(ix)
        net.eval(); vl,_=evaluate(val); scheduler.step(vl)
        history.append(dict(epoch=epoch,train_loss=total/len(train[0]),validation_loss=vl,lr=opt.param_groups[0]['lr']))
        if vl<best-1e-5:
            best=vl; best_state={k:v.clone() for k,v in net.state_dict().items()}; best_epoch=epoch; stale=0
        else: stale+=1
        if epoch==1 or epoch%20==0: print(f'epoch={epoch} train={history[-1]["train_loss"]:.4f} validation={vl:.4f}',flush=True)
        if epoch>=args.min_epochs and stale>=args.patience: break
    net.load_state_dict(best_state); net.eval()
    test_loss,(pl,al)=evaluate(test)
    probes=[]
    for p,a in [(0,0),(0,1),(0,2),(0,3),(0,4),(1,0),(2,0),(3,0),(1,3)]:
        x,_,_=generated(88000+p*1000+a,p,a,stress=True)
        with torch.no_grad(): out=net((torch.tensor(x)[None]-mean)/scale)
        probes.append(dict(postureLabel=p,activityLabel=a,sequence=x.tolist(),posture=out[0][0].tolist(),activity=out[1][0].tolist()))
    payload=dict(version=2,synthetic=not bool(args.manifest),frames=40,features=FEATURES,postures=POSTURES,activities=ACTIVITIES,
                 mean=mean.tolist(),scale=scale.tolist(),dilations=[1,2,4],channels=[26,24,24,24],
                 weights={k:v.tolist() for k,v in net.state_dict().items()},probe=probes[0],probes=probes)
    path=Path(args.output); path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(payload,allow_nan=False),encoding='utf-8')
    report=dict(synthetic_only=not bool(args.manifest),seed=202,torch=torch.__version__,max_epochs=args.epochs,actual_epochs=len(history),best_epoch=best_epoch,
                initial_validation_loss=initial,best_validation_loss=best,test_loss=test_loss,posture=metrics(pl,test[1],4),activity=metrics(al,test[2],5),
                split=provenance or dict(train=list(range(40)),validation=list(range(40,50)),test=list(range(50,60))),
                samples={r:len(d[0]) for r,d in zip(['train','validation','test'],datasets)},
                model_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                limitation='Generated feature simulations only; no actual human posture/stretching performance or 0.1-to-0.2 accuracy comparison.')
    out=Path('artifacts/face-lab'); out.mkdir(parents=True,exist_ok=True)
    (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    (out/'history.json').write_text(json.dumps(history,indent=2),encoding='utf-8')
    torch.save(dict(train=train,validation=val,test=test,mean=mean,scale=scale),out/'split-tensors.pt')
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__': main()
