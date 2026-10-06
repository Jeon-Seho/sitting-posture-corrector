"""LSTM training with reviewed participant splits; synthetic mode is integration only."""
import argparse
import hashlib
import json
import math
import random
from pathlib import Path

LABELS = ['normal', 'movement', 'deviation']
FRAMES = 30


def sequence(seed, label):
    rng = random.Random(seed)
    amplitude = rng.uniform(.14, .65)
    axis = rng.randrange(3)
    sign = rng.choice([-1, 1])
    phase = rng.uniform(0, 6.28)
    frequency = rng.uniform(3, 7)
    subtype = rng.randrange(3)
    onset = rng.randrange(0, 10)
    noise = rng.uniform(.004, .025)
    # Canonical nose/shoulder geometry, projected into varied image positions/sizes.
    # These are generated bodies/cameras, not captured people.
    shoulder_span = rng.uniform(.2, .38)
    base_gap = rng.uniform(.45, .85)
    translate_x, translate_y = rng.uniform(-.1, .1), rng.uniform(-.08, .08)
    camera_scale = rng.uniform(.8, 1.15)
    rows = []
    previous = [0., 0., 0.]
    for t in range(FRAMES):
        values = [rng.gauss(0, noise) for _ in range(3)]
        if label == 0:
            values[axis] += rng.uniform(.02, .085) * math.sin(t / 8 + phase)
        elif label == 1:
            # Turn/return, shoulder-lift pulse and continuous movement proxies.
            profile = math.sin(t / frequency + phase) if subtype == 0 else math.sin(math.pi * t / 29) ** (1 if subtype == 1 else 3)
            values[axis] += sign * amplitude * profile
            values[(axis + 1) % 3] += amplitude * .2 * math.sin(t / frequency)
        else:
            values[axis] += sign * amplitude * min(1., max(0., (t - onset) / 4))
        # Feature extraction from projected three-point skeleton. Translation and scale
        # cancel; head-only changes survive. Image aspect is absorbed into pixel units.
        span = shoulder_span * camera_scale
        cx, cy = .5 + translate_x, .6 + translate_y
        left = (cx - span / 2, cy + values[2] * span / 2)
        right = (cx + span / 2, cy - values[2] * span / 2)
        nose = (cx + values[1] * span, cy - (base_gap + values[0]) * span)
        measured_span = math.hypot(left[0] - right[0], left[1] - right[1])
        values = [(cy - nose[1]) / measured_span - base_gap, (nose[0] - cx) / measured_span,
                  (left[1] - right[1]) / measured_span]
        rows.append(values + [values[i] - previous[i] if t else 0. for i in range(3)])
        previous = values
    return rows


def main():
    import torch
    from torch import nn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='frontend/public/lab-model.json')
    parser.add_argument('--epochs', type=int, default=1000)
    parser.add_argument('--min-epochs', type=int, default=100)
    parser.add_argument('--patience', type=int, default=40)
    parser.add_argument('--batch-size', type=int, default=96)
    parser.add_argument('--learning-rate', type=float, default=.003)
    parser.add_argument('--manifest', help='Private reviewed data manifest; omit only for synthetic integration')
    parser.add_argument('--takes', type=int, default=100, help='Generated sequences per class per synthetic identity')
    args = parser.parse_args()
    if args.epochs < 1 or args.min_epochs < 1 or args.patience < 1 or args.batch_size < 1 or not 1 <= args.takes <= 1000 or not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        parser.error('Training parameters must be positive and finite')
    torch.manual_seed(122)
    torch.set_num_threads(2)

    class Network(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(6, 16, num_layers=2, dropout=.15, batch_first=True)
            self.head = nn.Linear(16, 3)

        def forward(self, x):
            output, _ = self.lstm(x)
            return self.head(output[:, -1])

    # Disjoint synthetic identities/seeds before generating sequences; not human participants.
    def dataset(start, count):
        rows, labels = [], []
        for identity in range(start, start + count):
            for label in range(3):
                for take in range(args.takes):
                    rows.append(sequence(identity * 100000 + label * 1000 + take, label))
                    labels.append(label)
        return torch.tensor(rows), torch.tensor(labels)

    provenance = None
    if args.manifest:
        from relative_lab_data import load_manifest
        groups, provenance = load_manifest(args.manifest)
        (train_x, train_y), (val_x, val_y), (test_x, test_y) = [
            (torch.tensor(groups[role][0], dtype=torch.float32), torch.tensor(groups[role][1])) for role in ('train', 'validation', 'test')]
    else:
        train_x, train_y = dataset(0, 20)
        val_x, val_y = dataset(20, 5)
        test_x, test_y = dataset(25, 5)
    mean = train_x.reshape(-1, 6).mean(0)
    scale = train_x.reshape(-1, 6).std(0).clamp_min(.01)
    train_x, val_x, test_x = [(x - mean) / scale for x in (train_x, val_x, test_x)]
    net = Network()
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.learning_rate, weight_decay=.001)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10, factor=.5, min_lr=1e-6)
    best_loss, best_state = float('inf'), None
    best_epoch, stale = 0, 0
    history = []
    counts = torch.bincount(train_y, minlength=3).float()
    class_weights = counts.sum() / (3 * counts)
    for epoch in range(args.epochs):
        net.train()
        train_loss = 0.
        for indices in torch.randperm(len(train_y)).split(args.batch_size):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(net(train_x[indices]), train_y[indices], weight=class_weights)
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.)
            optimizer.step()
            train_loss += loss.item() * len(indices)
        net.eval()
        with torch.no_grad():
            validation_loss = nn.functional.cross_entropy(net(val_x), val_y).item()
            validation_accuracy = float((net(val_x).argmax(1) == val_y).float().mean())
        history.append(dict(epoch=epoch+1, train_loss=train_loss / len(train_y), validation_loss=validation_loss,
                            validation_accuracy=validation_accuracy, learning_rate=optimizer.param_groups[0]['lr']))
        scheduler.step(validation_loss)
        if validation_loss < best_loss:
            best_loss = validation_loss
            best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
            best_epoch = epoch + 1
            stale = 0
        else:
            stale += 1
        if epoch % 20 == 0:
            print(f'epoch={epoch} validation_loss={validation_loss:.5f}', flush=True)
        if epoch + 1 >= args.min_epochs and stale >= args.patience:
            print(f'Early stopping at epoch {epoch + 1}; best epoch {best_epoch}', flush=True)
            break
    net.load_state_dict(best_state)
    net.eval()
    with torch.no_grad():
        predicted = net(test_x).argmax(1)
        confusion = [[int(((test_y == i) & (predicted == j)).sum()) for j in range(3)] for i in range(3)]
        accuracy = float((predicted == test_y).float().mean())
        test_loss = nn.functional.cross_entropy(net(test_x), test_y).item()
        recalls = [confusion[i][i] / max(1, sum(confusion[i])) for i in range(3)]
        precisions = [confusion[i][i] / max(1, sum(row[i] for row in confusion)) for i in range(3)]
        macro_f1 = sum(2*p*r / (p+r) if p+r else 0 for p, r in zip(precisions, recalls)) / 3
        probe = sequence(999999, 1)
        logits = net((torch.tensor([probe]) - mean) / scale)[0].tolist()
    payload = dict(version=1, synthetic=not bool(args.manifest), labels=LABELS, frames=FRAMES, intervalMs=100,
                   inputSize=6, hiddenSize=16, numLayers=2, mean=mean.tolist(), scale=scale.tolist(),
                   weights={k: v.tolist() for k, v in net.state_dict().items()},
                   probe=dict(sequence=probe, logits=logits))
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, allow_nan=False), encoding='utf-8')
    report = dict(synthetic_only=not bool(args.manifest), seed=122, torch=torch.__version__, max_epochs=args.epochs,
                  actual_epochs=len(history), best_epoch=best_epoch, best_validation_loss=best_loss,
                  generated_takes=args.takes if not args.manifest else None,
                  split=provenance or dict(train=list(range(20)), validation=list(range(20,25)), test=list(range(25,30))),
                  samples=dict(train=len(train_y), validation=len(val_y), test=len(test_y)),
                  labels=LABELS, confusion=confusion, accuracy=accuracy, error_rate=1-accuracy,
                  test_loss=test_loss, macro_f1=macro_f1, recalls=recalls,
                  model_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                  source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  limitation='Synthetic results are not human performance; stretching is not a supervised class.')
    output = Path('artifacts/relative-lab/report.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    output.with_name('history.json').write_text(json.dumps(history, indent=2), encoding='utf-8')
    torch.save(dict(train_x=train_x, train_y=train_y, validation_x=val_x, validation_y=val_y, test_x=test_x, test_y=test_y), output.with_name('split-tensors.pt'))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
