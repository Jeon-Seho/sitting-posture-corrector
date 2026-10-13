"""Export a trusted research LSTM to an ignored browser asset, with synthetic parity inputs."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from model.analysis.panoptic_lstm import Forecast, ROOT, private_path, sha256


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model',type=Path,required=True)
    a=p.parse_args(); path=private_path(a.model)
    bundle=torch.load(path,map_location='cpu',weights_only=True)
    config={'steps':30,'dimensions':39,'hidden':48,'horizon':3,
            'point_definition':'Panoptic-face9-body4-not-MediaPipe'}
    if bundle['config']!=config:raise ValueError('Unsupported model')
    model=Forecast();model.load_state_dict(bundle['state_dict']);model.eval()
    data={'schema_version':'forecast-weights-v1','model_id':'panoptic-lstm-v1',
          'source_sha256':sha256(path),'domain_validated':False,'config':config,
          'mean':bundle['mean'].tolist(),'scale':bundle['scale'].tolist(),
          'weights':{k:v.flatten().tolist() for k,v in bundle['state_dict'].items()}}
    folder=ROOT/'frontend/public/research-model';folder.mkdir(parents=True,exist_ok=True)
    (folder/'forecast.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
    x=np.sin(np.arange(30*39,dtype=np.float32).reshape(30,39)*.01)*.1
    x=x.astype(np.float32)
    with torch.no_grad():
        tx=(torch.from_numpy(x)-bundle['mean'])/bundle['scale']
        y=(model(tx[None])[0]*bundle['scale']+bundle['mean']).numpy()
    output=ROOT/'runs/panoptic/browser-parity';output.mkdir(parents=True,exist_ok=True)
    (output/'explicit-synthetic-parity.json').write_text(json.dumps({'input':x.tolist(),'expected':y.tolist()}))
    print(json.dumps({'asset_bytes':(folder/'forecast.json').stat().st_size,'model_hash':data['source_sha256']}))


if __name__=='__main__':main()
