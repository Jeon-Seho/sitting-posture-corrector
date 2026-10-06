"""Report figures for generated data only; no claim of human accuracy."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root=Path('artifacts/face-lab')
history=json.loads((root/'history.json').read_text())
report=json.loads((root/'report.json').read_text())
fig,axes=plt.subplots(1,3,figsize=(14,4),layout='constrained')
axes[0].plot([x['epoch'] for x in history],[x['train_loss'] for x in history],label='Train')
axes[0].plot([x['epoch'] for x in history],[x['validation_loss'] for x in history],label='Validation')
axes[0].axvline(report['best_epoch'],color='grey',linestyle='--',label='Selected epoch')
axes[0].set(xlabel='Epoch',ylabel='Two-head cross-entropy (log scale)',yscale='log',title='Learning curves');axes[0].legend()
for ax,key,labels in zip(axes[1:],['posture','activity'],[['neutral','forward','slouch','tilt'],['still','turn','move','arms','neck']]):
    confusion=report[key]['confusion'];ax.imshow(confusion,cmap='Greens');ax.set_xticks(range(len(labels)),labels,rotation=40,ha='right');ax.set_yticks(range(len(labels)),labels);ax.set(xlabel='Predicted',ylabel='Label',title=key.capitalize())
    for i,row in enumerate(confusion):
        for j,n in enumerate(row):ax.text(j,i,str(n),ha='center',va='center',color='black')
fig.suptitle('PoseGood 0.2.0: generated feature simulations (NOT human performance)',fontsize=12)
fig.savefig(root/'learning-curves.png',dpi=180);fig.savefig(root/'learning-curves.svg');plt.close(fig)
