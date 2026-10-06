"""Reproducible local training, validation-only selection and one holdout evaluation."""

import json
import platform
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from ..dataset.prepare import ROOT, write_private
from .classifier import evaluate, fit, fit_scaler, training_examples
from .data import FEATURES, load_config, prepare, sha256


OUTPUTS = ("models.json", "report.json", "report.md", "manifest.json")


def validate_output(output):
    target = Path(output).resolve()
    if target.exists():
        raise ValueError("Output must be a new directory; never overwrite a previous experiment")
    if target == ROOT or ROOT in target.parents:
        for name in OUTPUTS:
            result = subprocess.run(["git", "check-ignore", "--no-index", "--quiet", str(target / name)], cwd=ROOT, capture_output=True)
            if result.returncode != 0:
                raise ValueError("All personal outputs including weights must be Git-ignored")
    return target


def assert_unchanged(config):
    if sha256(config.source) != config.sha256 or any(sha256(spec.path) != spec.sha256 for spec, _, _ in config.catalog):
        raise ValueError("Source or experiment configuration changed during training")


def code_metadata():
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    paths = list(Path(__file__).parent.glob("*.py")) + list((Path(__file__).parents[1] / "dataset").glob("*.py"))
    return {
        "git_revision": revision.stdout.strip(), "python_version": platform.python_version(),
        "module_sha256": {str(p.relative_to(ROOT)): sha256(p) for p in sorted(paths)},
        "algorithm": "class-balanced multinomial logistic regression, full-batch gradient descent, L2",
    }


def build_experiment(config):
    # Role assignment is loaded before samples, window extraction, fitting or augmentation.
    groups, diagnostics = prepare(config)
    examples, scales = training_examples(groups["train"], config.document["augmentation"], config.document["seed"])
    original = [e for e in examples if not e["synthetic"]]
    scaler = fit_scaler(original)
    classes = list(config.label_mapping)
    candidates = {}
    for name, data in (("original", original), ("augmented", examples)):
        weights = fit(data, classes, scaler, config.document["optimizer"])
        candidates[name] = {"weights": weights, "training_examples": len(data), "validation": evaluate(groups["validation"], classes, scaler, weights)}
    # Compare only validation Macro-F1; exact tie chooses the original, simpler experiment.
    selected = "augmented" if candidates["augmented"]["validation"]["macro_f1"] > candidates["original"]["validation"]["macro_f1"] else "original"
    holdout = evaluate(groups["holdout"], classes, scaler, candidates[selected]["weights"])
    report = {
        "purpose": "same_person_feasibility", "not_cross_person_evaluation": True,
        "rows": sum(d["rows"] for d in diagnostics),
        "eligible_rows": sum(d["eligible_rows"] for d in diagnostics),
        "window_counts": {role: dict(Counter(w["label"] for w in windows)) for role, windows in groups.items()},
        "augmentation": {
            "original_windows": len(original), "synthetic_windows": len(examples) - len(original),
            "training_only": True, "pooled_within_class_training_sd": scales,
            "settings": config.document["augmentation"], "label_preservation_validated": False,
        },
        "validation": {name: candidate["validation"] for name, candidate in candidates.items()},
        "selection_rule": "validation_macro_f1; exact ties prefer original; holdout never used",
        "selected_model": selected, "holdout": holdout,
        "limitations": [
            "One person, same collection period, camera and personal baseline; not new-person or new-day performance.",
            "Self-reported whole-capture labels; no frame-by-frame ground truth.",
            "Synthetic windows are correlated perturbations, not independent people or captures.",
            "No LSTM, service integration, episode/false-alarm/detection-delay evaluation or clinical claims.",
        ],
    }
    model = {
        "schema_version": "posture-personal-softmax-v1", "purpose": "offline_personal_experiment_only",
        "classes": classes, "raw_features": list(FEATURES),
        "temporal_features": [f"{feature}_{stat}" for feature in FEATURES for stat in ("mean", "population_sd", "slope_per_second")],
        "scaler": scaler, "scaler_fit_on": "original_train_only",
        "selected_model": selected, "candidates": candidates,
        "probabilities_calibrated": False, "unmeasurable_policy": "Exclude low-quality windows; no posture prediction for them",
    }
    manifest = {
        "schema_version": "posture-personal-manifest-v1", "status": "complete",
        "data_kind": config.document["data_kind"], "configuration": config.document,
        "configuration_sha256": config.sha256, "code": code_metadata(),
        "capture_split": [{"path": str(spec.path), "sha256": spec.sha256, "capture_id": spec.capture_id, "split_role": role} for spec, _, role in config.catalog],
        "window_ids_by_role": {role: [w["window_id"] for w in windows] for role, windows in groups.items()},
        "diagnostics": diagnostics, "training_executed": True,
        "personal_baseline_source": "Previously registered baseline columns; reference frames unavailable; not refitted from holdout",
        "baseline_derivation_verified": False, "selection_before_holdout": True,
        "evaluation_unit": "nonoverlapping observed windows grouped by entire capture; same-person only",
    }
    return model, report, manifest


def render_report(report):
    validation = report["validation"]
    holdout = report["holdout"]
    classes = holdout["classes"]
    matrix = "\n".join("| " + " | ".join([label] + [str(n) for n in row]) + " |" for label, row in zip(classes, holdout["confusion_matrix"]))
    split = "\n".join(f"- {role}: {sum(counts.values())} windows, {counts}" for role, counts in report["window_counts"].items())
    limitations = "\n".join("- " + line for line in report["limitations"])
    return f'''# 본인 자세 첫 학습 실험

한 사람의 다른 촬영 회차 간 확인이다. 다른 사람·새 촬영일 성능을 평가하지 않았다.
CSV {report['rows']}행 중 {report['eligible_rows']}행이 준비 필터를 통과했다.
3초 관측 창의 delta 3개 평균·표준편차·시간 기울기 9개로 softmax 분류기를 학습했다.
라벨은 촬영 후 검토된 manual_label만 사용하며 과제 지시·규칙 예측·점수는 모델 입력이 아니다.

## 촬영 단위 분리와 증강

{split}

학습 원본 창 {report['augmentation']['original_windows']}개에 합성 변형 {report['augmentation']['synthetic_windows']}개를 추가했다.
스케일러·증강 크기는 원본 학습 자료에서만 계산했다. 검증/확인용 창은 변형하지 않았다.
증강은 작은 scaling/offset/jitter 탐색이며 라벨 보존이나 성능 개선을 입증하지 않는다.

## 검증 자료로 모델 선택

| 모델 | 검증 Macro-F1 | 검증 정확도 |
| --- | ---: | ---: |
| 원본 | {validation['original']['macro_f1']:.4f} | {validation['original']['accuracy']:.4f} |
| 증강 | {validation['augmented']['macro_f1']:.4f} | {validation['augmented']['accuracy']:.4f} |

선택: **{report['selected_model']}**. 동률이면 원본 모델을 선택했다. 확인용 촬영을 보기 전에 선택한다.

## 선택된 모델의 확인용 촬영 결과

{holdout['windows']}개 관측 창: 정확도 {holdout['accuracy']:.4f}, Macro-F1 {holdout['macro_f1']:.4f}, balanced accuracy {holdout['balanced_accuracy']:.4f}.
행은 실제 라벨, 열은 예측이다. 창은 독립 참여자 표본이 아니므로 이 창 수로 모집 규모/신뢰구간을 주장하지 않는다.

| 실제 / 예측 | {' | '.join(classes)} |
| --- | {' | '.join('---:' for _ in classes)} |
{matrix}

## 한계

{limitations}

원본은 변경하지 않았다. models.json은 연구용 가중치이며 현재 서비스에 연결하지 않았다.
재현 설정·원본 해시·촬영 분리·사용 코드 해시는 manifest.json에 보관한다.
'''


def run_experiment(config_path, output):
    target = validate_output(output)
    config = load_config(config_path)
    assert_unchanged(config)
    model, report, manifest = build_experiment(config)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".personal-stage-", dir=target.parent) as stage_dir:
        stage = Path(stage_dir)
        contents = {"models.json": model, "report.json": report, "manifest.json": manifest}
        for name, document in contents.items():
            write_private(stage / name, json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        write_private(stage / "report.md", render_report(report))
        manifest["output_sha256"] = {name: sha256(stage / name) for name in OUTPUTS if name != "manifest.json"}
        (stage / "manifest.json").unlink()
        write_private(stage / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        assert_unchanged(config)
        target.mkdir(mode=0o700, exist_ok=False)
        created = []
        try:
            for name in OUTPUTS:  # Completed manifest is published last.
                write_private(target / name, (stage / name).read_text(encoding="utf-8"))
                created.append(target / name)
        except BaseException:
            for path in created:
                path.unlink()
            try:
                target.rmdir()
            except OSError:
                pass
            raise
    return report
