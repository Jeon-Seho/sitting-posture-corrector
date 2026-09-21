"""Read local pilot CSVs with pandas; never upload or modify the source files."""
import argparse
from pathlib import Path
import pandas as pd


def summarize(paths):
    frames = [pd.read_csv(path, encoding="utf-8-sig", dtype={"participant_code": "string"}) for path in paths]
    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        raise ValueError("수집 행이 없습니다.")
    required = {"schema_version", "participant_code", "capture_id", "sample_index", "elapsed_ms", "gap_ms",
                "measurement_quality", "manual_label", "segment_id", "inference_ms", "delta_head_gap", "delta_offset", "delta_tilt", "pose_model"}
    if not required.issubset(df.columns) or not df.schema_version.isin(["posture-pilot-v1", "posture-pilot-v2"]).all():
        raise ValueError("posture-pilot-v1/v2 CSV가 필요합니다.")
    v2 = df.schema_version.eq("posture-pilot-v2")
    if v2.any() and not {"review_status", "pose_training_eligible", "presence_label", "task_id"}.issubset(df.columns):
        raise ValueError("v2 검토·과제 필드가 없습니다.")
    df = df.drop_duplicates(["capture_id", "sample_index"]).sort_values(["capture_id", "sample_index"])
    print(f"참여자 {df.participant_code.nunique()}명 / 수집 파일 {df.capture_id.nunique()}개 / {len(df)}행")
    print("\n스키마별 행 수 (Lite/Heavy와 다른 시점의 자료를 무조건 합쳐 학습하지 마세요)")
    print(df.groupby(["schema_version", "pose_model"], dropna=False).size().to_string())
    if df.schema_version.eq("posture-pilot-v2").any():
        print("\nv2 과제·검토 상태별 행 수")
        print(df[df.schema_version.eq("posture-pilot-v2")].groupby(["task_id", "review_status"], dropna=False).size().to_string())
    print("\n라벨·측정 품질별 행 수 (행 수는 지속시간이 아닙니다)")
    print(df.groupby(["manual_label", "measurement_quality"], dropna=False).size().to_string())
    print("\n추론 지연 ms (평균 / 중앙값 / p95)")
    print(df.inference_ms.agg(["mean", "median"]).to_string())
    print(f"p95: {df.inference_ms.quantile(.95):.2f}")
    print("\n수집 간격 ms (목표 100ms 이상, 고정 간격 아님)")
    print(df.gap_ms.dropna().describe().to_string())
    usable = df[df.measurement_quality.eq("good") & ~df.manual_label.isin(["unlabeled", "transition"])]
    if "review_status" in usable:
        usable = usable[usable.schema_version.eq("posture-pilot-v1") | (usable.review_status.eq("accepted") & usable.pose_training_eligible.eq(1))]
    print("\n수동 라벨별 기준 대비 특징 평균 (무단위)")
    print(usable.groupby("manual_label")[["delta_head_gap", "delta_offset", "delta_tilt"]].mean().to_string())
    print("\n파일럿 탐색용입니다. rule_prediction을 정답으로 쓰지 마세요.")
    print("학습 시 participant_code로 먼저 분할하고 capture_id·segment_id 경계를 넘는 시퀀스를 만들지 마세요.")
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        summarize(args.csv)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"CSV 확인 실패: {error}\n")
