package com.posture.api.report;

/**
 * (D-30, D-51) 저장에 필요한 {@code monitor_session} 값(DB V2.3). 행은 입출구 서버(팀 {@code backend/api})가 측정 시작 때 만든다(DB 회신 C-2).
 *
 * @param alertEnabled 측정 시작 때 복사한 알림 제공 여부. V2.3은 꺼져 있어도 알림 시점을 기록하고, 표시 여부는 이 값으로 판단한다
 * @param ended        이미 종료 값이 채워졌는지
 */
public record SessionRow(long id, boolean alertEnabled, boolean ended) {
}
