"""Load verified RF artifacts and score usable frames with the two-stage model."""

import hashlib
import io
import math
from pathlib import Path
from typing import Sequence

import numpy as np

from .frame_features import FrameFeatures


RF_MODEL = "frame-rf-100x"
RF_MODEL_VERSION = "frame-rf-100x-v1"
DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "pretrained" / RF_MODEL
MODEL_HASHES = {
    "frame-corrector.joblib": "95c6a22e7b997f18601e7355137381978d83b766c03dacf1e27e3eed018b468a",
    "frame-posture.joblib": "097ac911f8a98b4153cd98db135e55e0b52fa0ef971dbf247978609b407e0059",
}


class PredictionError(Exception):
    pass


class CompiledForest:
    """All trees of a fitted sklearn forest as arrays, evaluated together with numpy.

    One sklearn call costs a few milliseconds of fixed overhead per forest. Walking every tree at once
    gives the same numbers: inputs are cast to float32 like sklearn, each split is `x <= threshold`,
    and tree outputs are summed in estimator order before dividing by the tree count.
    """

    def __init__(self, forest, *, classifier: bool):
        trees = [estimator.tree_ for estimator in forest.estimators_]
        if not trees or any(tree.n_outputs != 1 for tree in trees):
            raise ValueError("single-output forest required")
        count, width = len(trees), max(tree.node_count for tree in trees)
        self.left = np.zeros((count, width), dtype=np.intp)
        self.right = np.zeros((count, width), dtype=np.intp)
        self.feature = np.zeros((count, width), dtype=np.intp)
        self.threshold = np.zeros((count, width), dtype=np.float64)
        self.value = np.zeros((count, width), dtype=np.float64)
        for index, tree in enumerate(trees):
            nodes = np.arange(tree.node_count)
            leaf = tree.children_left == -1
            # Leaves point at themselves so a fixed number of steps reaches every leaf.
            self.left[index, :tree.node_count] = np.where(leaf, nodes, tree.children_left)
            self.right[index, :tree.node_count] = np.where(leaf, nodes, tree.children_right)
            self.feature[index, :tree.node_count] = np.where(leaf, 0, tree.feature)
            self.threshold[index, :tree.node_count] = tree.threshold
            if classifier:
                if tree.value.shape[2] != 2:
                    raise ValueError("two-class forest required")
                # scikit-learn 1.6 stores class fractions and returns them as they are.
                self.value[index, :tree.node_count] = tree.value[:, 0, 1]
            else:
                self.value[index, :tree.node_count] = tree.value[:, 0, 0]
        self.depth = max(tree.max_depth for tree in trees)
        self.trees = np.arange(count)

    def predict(self, rows) -> np.ndarray:
        values = np.asarray(rows, dtype=np.float32).astype(np.float64)
        samples = np.arange(values.shape[0])[:, None]
        node = np.zeros((values.shape[0], len(self.trees)), dtype=np.intp)
        for _ in range(self.depth):
            left = values[samples, self.feature[self.trees, node]] <= self.threshold[self.trees, node]
            node = np.where(left, self.left[self.trees, node], self.right[self.trees, node])
        # cumsum adds tree by tree, the same order as sklearn's forest accumulation.
        return np.cumsum(self.value[self.trees, node], axis=1)[:, -1] / len(self.trees)


class FrameRandomForest:
    def __init__(self, corrector, classifier):
        if (getattr(corrector, "n_features_in_", None) != 7
                or not callable(getattr(corrector, "predict", None))):
            raise ValueError("invalid frame corrector")
        if (getattr(classifier, "n_features_in_", None) != 6
                or list(getattr(classifier, "classes_", ())) != [0, 1]
                or not callable(getattr(classifier, "predict_proba", None))):
            raise ValueError("invalid frame classifier")
        self.corrector = CompiledForest(corrector, classifier=False)
        self.classifier = CompiledForest(classifier, classifier=True)

    def predict_probabilities(self, features: Sequence[FrameFeatures], span: float) -> list[float]:
        """Batch the same per-frame correction and classification as FramePredictor."""
        try:
            corrections = self.corrector.predict([list(row) + [span] for row in features])
            if len(corrections) != len(features) or not all(math.isfinite(float(v)) for v in corrections):
                raise ValueError("invalid frame corrections")
            adjusted = [list(row) for row in features]
            for row, correction in zip(adjusted, corrections):
                row[4] -= float(correction) / span
            probabilities = [float(value) for value in self.classifier.predict(adjusted)]
            if len(probabilities) != len(features):
                raise ValueError("invalid frame probabilities")
            if not all(0 <= probability <= 1 for probability in probabilities):
                raise ValueError("invalid frame probabilities")
        except Exception:
            # Estimator errors can contain input features. Treat them as opaque.
            raise PredictionError("frame model prediction failed") from None
        return probabilities


def load_frame_model(directory: Path) -> FrameRandomForest:
    # Verify both artifacts before deserializing the exact bytes that were checked.
    artifacts = []
    for filename, expected in MODEL_HASHES.items():
        data = (directory / filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("frame model checksum mismatch")
        artifacts.append(data)

    import joblib

    corrector, classifier = (joblib.load(io.BytesIO(data)) for data in artifacts)
    return FrameRandomForest(corrector, classifier)
