"""Plot saved training history; requires optional matplotlib."""
import json
from pathlib import Path


def main():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    root = Path('artifacts/relative-lab')
    history = json.loads((root / 'history.json').read_text(encoding='utf-8'))
    report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
    epochs = [row['epoch'] for row in history]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.3), layout='constrained')
    fig.suptitle('PoseGood LSTM - SYNTHETIC skeleton data only', fontweight='bold')
    for key, label, color in [('train_loss', 'Training', '#c4532a'), ('validation_loss', 'Validation', '#3f7d52')]:
        axes[0].semilogy(epochs, [row[key] for row in history], label=label, color=color)
    axes[0].axvline(report['best_epoch'], color='#7c6b61', linestyle='--', label=f"Selected epoch {report['best_epoch']}")
    axes[0].set(xlabel='Epoch', ylabel='Cross entropy (log scale)', title='Loss and validation model selection')
    axes[0].legend(); axes[0].grid(alpha=.2)
    axes[1].plot(epochs, [100 * row['validation_accuracy'] for row in history], color='#3f7d52')
    axes[1].set(xlabel='Epoch', ylabel='Validation accuracy (%)', ylim=(0, 101), title='Not measured human performance')
    axes[1].grid(alpha=.2)
    fig.savefig(root / 'learning-curves.png', dpi=170)
    fig.savefig(root / 'learning-curves.svg')


if __name__ == '__main__':
    main()
