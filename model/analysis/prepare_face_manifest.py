"""Reviewed local captures; explicit participant splits selected before fitting."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from face_motion_data import load_manifest


def main():
    p=argparse.ArgumentParser()
    for role in ['train','validation','test']:p.add_argument('--'+role,nargs='+',required=True)
    p.add_argument('--consent',action='store_true')
    p.add_argument('--output',required=True)
    args=p.parse_args()
    if not args.consent:p.error('Confirm consent for actual captures')
    output=Path(args.output).resolve();repository=Path(__file__).resolve().parents[2]
    if repository in output.parents and repository/'artifacts' not in output.parents:p.error('Private manifest must be outside repository or inside ignored artifacts/')
    if output.exists():p.error('Refusing to overwrite an existing manifest')
    files=[]
    for role in ['train','validation','test']:
        for value in getattr(args,role):
            source=Path(value).resolve();payload=source.read_bytes();record=json.loads(payload)
            files.append(dict(split=role,path=os.path.relpath(source,output.parent),participantCode=record['participantCode'],captureId=record['captureId'],consent=True,sha256=hashlib.sha256(payload).hexdigest()))
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as f:json.dump(dict(schema='face-motion-manifest-v2',files=files),f,indent=2)
    try:load_manifest(output)
    except Exception:output.unlink();raise
    print('Reviewed manifest validated. No training or upload performed.')


if __name__=='__main__':main()
