package com.posture.api.report;

/**
 * (D-54) 표시할 알림을 {@code posture.alerts.v1}로 내보낸다. 판정 결과 저장이 알림 행을 새로 기록하고, 세션 알림이 켜져 있고,
 * 사건이 오래되지 않았을 때만 부른다({@link EpisodeStoreService}).
 */
public interface AlertPublisher {

    /** 시험·끔 설정용: 아무것도 보내지 않는다. */
    AlertPublisher NO_OP = d -> { };

    /** @param d 알림을 낸 decision(collapse_confirmed·reminder) */
    void publish(EpisodeDecision d);
}
