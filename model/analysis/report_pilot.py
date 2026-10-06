"""Read pilot CSV with pandas and write a local report/plot; leave the source unchanged."""

import argparse
import hashlib
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt


FEATURE_COLORS = [
    ("delta_head_gap", "Head height", "#be6e42"),
    ("delta_offset", "Lateral offset", "#286f8b"),
    ("delta_tilt", "Shoulder tilt", "#7a649d"),
]


@dataclass
class CaptureSummary:
    good_samples: pd.DataFrame
    blocks: pd.DataFrame
    gaps: pd.Series
    covered_seconds: float
    row_rate: float
    dominant_changes: pd.Series
    score_mismatches: int


def read_capture(source):
    samples = pd.read_csv(source, encoding="utf-8-sig")
    if samples.empty or not samples.schema_version.isin(
        ["posture-pilot-v1", "posture-pilot-v2"]
    ).all():
        raise ValueError("Nonempty posture-pilot-v1/v2 CSV required")
    if samples.capture_id.nunique() != 1:
        raise ValueError("This report expects one capture per CSV")
    if samples.duplicated(["capture_id", "sample_index"]).any():
        raise ValueError("Duplicate samples: review the source before analysis")
    if not samples.elapsed_ms.is_monotonic_increasing:
        raise ValueError("Timestamps must be increasing")
    samples["posture_score"] = (1 - samples.rule_score) * 100
    return samples


def summarize_capture(samples):
    good_samples = samples[samples.measurement_quality.eq("good")].copy()
    blocks = samples.groupby("segment_id", sort=False).agg(
        rows=("sample_index", "size"),
        start=("elapsed_ms", "min"),
        end=("elapsed_ms", "max"),
    )
    blocks["span_seconds"] = (blocks.end - blocks.start) / 1000
    gaps = samples.elapsed_ms.diff()
    contiguous = samples.segment_id.eq(samples.segment_id.shift()) & gaps.le(1000)
    covered_seconds = float(gaps[contiguous].sum() / 1000)
    row_rate = int(contiguous.sum()) / covered_seconds if covered_seconds else float("nan")

    components = pd.DataFrame({
        "head": good_samples.delta_head_gap.abs() / .22,
        "lateral": good_samples.delta_offset.abs() / .20,
        "shoulder": good_samples.delta_tilt.abs() / .13,
    })
    expected_score = np.minimum(1, components.max(axis=1) * .7)
    score_mismatches = int((expected_score - good_samples.rule_score).abs().gt(1e-5).sum())
    return CaptureSummary(
        good_samples=good_samples,
        blocks=blocks,
        gaps=gaps,
        covered_seconds=covered_seconds,
        row_rate=row_rate,
        dominant_changes=components.idxmax(axis=1).value_counts(),
        score_mismatches=score_mismatches,
    )


def plot_capture(samples, summary, output):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    figure, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=True, layout="constrained")
    figure.patch.set_facecolor("#f5f3ec")
    for axis in axes:
        axis.set_facecolor("#faf9f4")
        axis.grid(axis="y", alpha=.2)
        axis.spines[["top", "right"]].set_visible(False)

    for _, segment in samples.groupby("segment_id", sort=False):
        elapsed_seconds = segment.elapsed_ms / 1000
        axes[0].plot(elapsed_seconds, segment.posture_score, color="#267367", lw=1.8)
        for column, _, color in FEATURE_COLORS:
            axes[1].plot(elapsed_seconds, segment[column], color=color, lw=1.1)
    for index in samples.index[summary.gaps.gt(1000)]:
        gap_start = samples.loc[index - 1, "elapsed_ms"] / 1000
        gap_end = samples.loc[index, "elapsed_ms"] / 1000
        for axis in axes:
            axis.axvspan(gap_start, gap_end, color="#727b82", alpha=.13)

    axes[0].axhline(
        100 * (1 - samples.threshold.iloc[0]),
        color="#b94646",
        ls="--",
        label="Alert threshold (display scale)",
    )
    axes[0].set(
        ylim=(0, 102),
        ylabel="Posture score (100 = reference)",
        title="Pilot recording: score and raw feature changes",
    )
    axes[0].legend(loc="lower left", frameon=False)
    for _, name, color in FEATURE_COLORS:
        axes[1].plot([], [], label=name, color=color)
    axes[1].set(
        xlabel="Elapsed seconds — shaded areas have no recorded samples",
        ylabel="Signed change / shoulder width",
    )
    axes[1].legend(loc="lower left", ncol=3, frameon=False)
    figure.savefig(output / "pilot-analysis.png", dpi=160)
    plt.close(figure)


def render_markdown(source, source_hash, samples, summary):
    good_samples = summary.good_samples
    labels = "\n".join(
        f"- `{label}`: {count}행"
        for label, count in samples.manual_label.value_counts().items()
    )
    segments = "\n".join(
        f"| {index} | {int(row.rows)} | {row.start / 1000:.3f}–{row.end / 1000:.3f} "
        f"| {row.span_seconds:.3f} |"
        for index, row in summary.blocks.iterrows()
    )
    long_gaps = ", ".join(
        f"{gap / 1000:.3f}초" for gap in summary.gaps[summary.gaps.gt(1000)]
    ) or "없음"
    if samples.rule_prediction.eq("normal").all():
        interpretation = "이번 기록에서는 기준 자세 주변의 움직임이 점수를 변화시켰지만 경고 임계값을 넘지 않았다."
    else:
        interpretation = "정상·이탈·측정 불가의 행별 비율은 위 규칙 예측 집계를 따른다."

    return f'''# 사용자 파일럿 CSV 분석

pandas {pd.__version__}로 읽기 전용 분석. 원본: `{source.name}`.
SHA-256: `{source_hash}`.

## 결과

- {len(samples):,}행, {samples.participant_code.nunique()}명, {samples.capture_id.nunique()}개 수집 파일. 중복 행 0개.
- 시간축 {(samples.elapsed_ms.max() - samples.elapsed_ms.min()) / 1000:.3f}초. 같은 segment 안의 연속 관측 간격 합 {summary.covered_seconds:.3f}초.
- 1초 초과 수집 공백: {long_gaps}. 공백 원인(휴식/탭 숨김/실행 지연 등)은 파일만으로 확정할 수 없다.
- 측정 품질 good: {len(good_samples)}/{len(samples)}행 ({len(good_samples) / len(samples) * 100:.1f}%). 실제 자세 판정 정확도를 뜻하지 않는다.
- 새 화면 방향의 점수 `100 × (1 - rule_score)`: 평균 {good_samples.posture_score.mean():.2f}, 중앙값 {good_samples.posture_score.median():.2f}, 범위 {good_samples.posture_score.min():.2f}–{good_samples.posture_score.max():.2f}점.
- 규칙 예측: {samples.rule_prediction.value_counts().to_dict()}. rule_score 최고 {good_samples.rule_score.max():.6f}, 설정 임계값 {samples.threshold.iloc[0]:.2f}.
- 추론 시간: 평균 {samples.inference_ms.mean():.2f}ms, 중앙값 {samples.inference_ms.median():.2f}ms, p95 {samples.inference_ms.quantile(.95):.2f}ms. 실행 장치 {', '.join(samples.delegate.unique())}.
- 연속 구간의 CSV 간격 기준 약 {summary.row_rate:.2f}행/초. CSV는 최대 10Hz로 다운샘플되므로 카메라 추적 FPS를 이 수치로 판단할 수 없다.
- 저장 특징에서 재계산한 규칙 점수 불일치: {summary.score_mismatches}행 (반올림 오차 허용 1e-5).

## 라벨과 해석

{labels}

{interpretation}
가장 큰 변화 항목의 행 수는 {summary.dominant_changes.to_dict()}이다. 좌우 흔들림도 점수에 영향을 준다.
이는 원래 규칙이 머리 높이·좌우 치우침·어깨 기울기 중 가장 큰 변화를 사용하기 때문이다.

라벨 {samples.manual_label.nunique()}종류의 기록이다. 미지정은 정답이 아니며, v2는 review_status와 pose_training_eligible도 확인한다.
이 보고서는 제외 구간도 포함한 수집 진단이며 학습 데이터 선별을 대신하지 않는다. 여기서 분류 정확도, 민감도, 오알림률을 추정하거나
이 파일만 보고 임계값을 튜닝하면 안 된다. 정상 움직임과 각 이탈 자세를 구분해 여러 파일/참여자에서 모아야 한다.
기준 재등록·카메라 위치·라벨 지침을 일정하게 하고, 자세 전환 중에는 transition 라벨을 사용한다.

## 연속 구간

| segment_id | 행 수 | 시작–끝 (초) | 구간 폭 (초) |
| --- | ---: | ---: | ---: |
{segments}

구간 폭은 관측 첫 행과 마지막 행 사이의 시간이며 실제 총 착석 시간과 다르다.
회색 영역을 정상/이탈로 채우거나 이 경계를 넘는 학습 시퀀스를 만들지 않는다.

![점수와 특징 시간축](pilot-analysis.png)

화면 점수만 반전했으며 원본 CSV의 rule_score는 변경하지 않았다. 영상은 없다. v1에는 원본 좌표가 없고 v2에는 추정 좌표 JSON 열이 있다.
'''


def report(source, output):
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    samples = read_capture(source)
    summary = summarize_capture(samples)
    output.mkdir(parents=True, exist_ok=True)
    plot_capture(samples, summary, output)
    markdown = render_markdown(source, source_hash, samples, summary)
    (output / "analysis.md").write_text(markdown, encoding="utf-8")
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Source changed during analysis")
    print(output / "analysis.md")
    print(output / "pilot-analysis.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report(args.csv, args.output)


if __name__ == "__main__":
    main()
