"""Read pilot CSV with pandas and write a local report/plot; leave the source unchanged."""
import argparse
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def report(source, output):
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    d = pd.read_csv(source, encoding='utf-8-sig')
    if d.empty or not d.schema_version.isin(['posture-pilot-v1', 'posture-pilot-v2']).all():
        raise ValueError('Nonempty posture-pilot-v1/v2 CSV required')
    if d.capture_id.nunique() != 1:
        raise ValueError('This report expects one capture per CSV')
    duplicates = int(d.duplicated(['capture_id', 'sample_index']).sum())
    if duplicates:
        raise ValueError('Duplicate samples: review the source before analysis')
    if not d.elapsed_ms.is_monotonic_increasing:
        raise ValueError('Timestamps must be increasing')
    d['posture_score'] = (1 - d.rule_score) * 100
    g = d[d.measurement_quality.eq('good')].copy()
    blocks = d.groupby('segment_id', sort=False).agg(rows=('sample_index','size'), start=('elapsed_ms','min'), end=('elapsed_ms','max'))
    blocks['span_seconds'] = (blocks.end - blocks.start) / 1000
    gaps = d.elapsed_ms.diff()
    contiguous = d.segment_id.eq(d.segment_id.shift()) & gaps.le(1000)
    covered = float(gaps[contiguous].sum()/1000)
    rate = int(contiguous.sum())/covered if covered else float('nan')
    components = pd.DataFrame({'head': g.delta_head_gap.abs()/.22, 'lateral': g.delta_offset.abs()/.20, 'shoulder': g.delta_tilt.abs()/.13})
    dominant = components.idxmax(axis=1).value_counts()
    expected = np.minimum(1, components.max(axis=1)*.7)
    mismatch = int((expected - g.rule_score).abs().gt(1e-5).sum())
    output.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10})
    fig, axes = plt.subplots(2,1,figsize=(12,7),sharex=True,layout='constrained')
    fig.patch.set_facecolor('#f5f3ec')
    for ax in axes:
        ax.set_facecolor('#faf9f4'); ax.grid(axis='y',alpha=.2); ax.spines[['top','right']].set_visible(False)
    for _, part in d.groupby('segment_id',sort=False):
        axes[0].plot(part.elapsed_ms/1000,part.posture_score,color='#267367',lw=1.8)
        for col,color in [('delta_head_gap','#be6e42'),('delta_offset','#286f8b'),('delta_tilt','#7a649d')]:
            axes[1].plot(part.elapsed_ms/1000,part[col],color=color,lw=1.1)
    for i in d.index[gaps.gt(1000)]:
        for ax in axes: ax.axvspan(d.loc[i-1,'elapsed_ms']/1000,d.loc[i,'elapsed_ms']/1000,color='#727b82',alpha=.13)
    axes[0].axhline(100*(1-d.threshold.iloc[0]),color='#b94646',ls='--',label='Alert threshold (display scale)')
    axes[0].set(ylim=(0,102),ylabel='Posture score (100 = reference)',title='Pilot recording: score and raw feature changes')
    axes[0].legend(loc='lower left',frameon=False)
    for name,color in [('Head height','#be6e42'),('Lateral offset','#286f8b'),('Shoulder tilt','#7a649d')]:
        axes[1].plot([],[],label=name,color=color)
    axes[1].set(xlabel='Elapsed seconds — shaded areas have no recorded samples',ylabel='Signed change / shoulder width')
    axes[1].legend(loc='lower left',ncol=3,frameon=False)
    fig.savefig(output/'pilot-analysis.png',dpi=160); plt.close(fig)
    labels = '\n'.join(f'- `{label}`: {count}행' for label,count in d.manual_label.value_counts().items())
    segments = '\n'.join(f'| {index} | {int(row.rows)} | {row.start/1000:.3f}–{row.end/1000:.3f} | {row.span_seconds:.3f} |' for index,row in blocks.iterrows())
    long_gaps = ', '.join(f'{x/1000:.3f}초' for x in gaps[gaps.gt(1000)]) or '없음'
    interpretation = ('이번 기록에서는 기준 자세 주변의 움직임이 점수를 변화시켰지만 경고 임계값을 넘지 않았다.'
        if d.rule_prediction.eq('normal').all() else '정상·이탈·측정 불가의 행별 비율은 위 규칙 예측 집계를 따른다.')
    text = f'''# 사용자 파일럿 CSV 분석

pandas {pd.__version__}로 읽기 전용 분석. 원본: `{source.name}`.
SHA-256: `{before}`.

## 결과

- {len(d):,}행, {d.participant_code.nunique()}명, {d.capture_id.nunique()}개 수집 파일. 중복 행 {duplicates}개.
- 시간축 {(d.elapsed_ms.max()-d.elapsed_ms.min())/1000:.3f}초. 같은 segment 안의 연속 관측 간격 합 {covered:.3f}초.
- 1초 초과 수집 공백: {long_gaps}. 공백 원인(휴식/탭 숨김/실행 지연 등)은 파일만으로 확정할 수 없다.
- 측정 품질 good: {len(g)}/{len(d)}행 ({len(g)/len(d)*100:.1f}%). 실제 자세 판정 정확도를 뜻하지 않는다.
- 새 화면 방향의 점수 `100 × (1 - rule_score)`: 평균 {g.posture_score.mean():.2f}, 중앙값 {g.posture_score.median():.2f}, 범위 {g.posture_score.min():.2f}–{g.posture_score.max():.2f}점.
- 규칙 예측: {d.rule_prediction.value_counts().to_dict()}. rule_score 최고 {g.rule_score.max():.6f}, 설정 임계값 {d.threshold.iloc[0]:.2f}.
- 추론 시간: 평균 {d.inference_ms.mean():.2f}ms, 중앙값 {d.inference_ms.median():.2f}ms, p95 {d.inference_ms.quantile(.95):.2f}ms. 실행 장치 {', '.join(d.delegate.unique())}.
- 연속 구간의 CSV 간격 기준 약 {rate:.2f}행/초. CSV는 최대 10Hz로 다운샘플되므로 카메라 추적 FPS를 이 수치로 판단할 수 없다.
- 저장 특징에서 재계산한 규칙 점수 불일치: {mismatch}행 (반올림 오차 허용 1e-5).

## 라벨과 해석

{labels}

{interpretation}
가장 큰 변화 항목의 행 수는 {dominant.to_dict()}이다. 좌우 흔들림도 점수에 영향을 준다.
이는 원래 규칙이 머리 높이·좌우 치우침·어깨 기울기 중 가장 큰 변화를 사용하기 때문이다.

라벨 {d.manual_label.nunique()}종류의 기록이다. 미지정은 정답이 아니며, v2는 review_status와 pose_training_eligible도 확인한다.
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
    (output/'analysis.md').write_text(text,encoding='utf-8')
    if hashlib.sha256(source.read_bytes()).hexdigest() != before:
        raise RuntimeError('Source changed during analysis')
    print(output/'analysis.md')
    print(output/'pilot-analysis.png')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv',type=Path); parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); report(args.csv,args.output)
