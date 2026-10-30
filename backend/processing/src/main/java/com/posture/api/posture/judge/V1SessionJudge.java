package com.posture.api.posture.judge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * (D-22) 세션 1개의 실시간 계약 v1 판정 — 관측 v2를 받아 사건 v1과 세션 요약을 만든다.
 *
 * <p>시간은 모두 <b>세션 기준 ms(관측의 start_ms/end_ms)</b>로 계산한다(서버 수신 시각을 쓰지 않음).
 * 지속·복귀 시간은 판정 가능한 구간 길이의 누적이다.
 *
 * <ul>
 *   <li>측정 구간(running·valid): 점수 ≥ 정책 threshold면 붕괴 후보. 후보 누적 ≥ hold_ms → {@code collapse_confirmed},
 *       사건 중 정상 누적 ≥ recovery_ms → {@code recovery_confirmed}, 사건 중 마지막 알림부터 ≥ reminder_ms → {@code reminder}.
 *       반대 상태 구간이 하나라도 오면 누적은 0(FE 회신 ③).</li>
 *   <li>제외 구간(running이 아니거나 valid=false): 진행 중 사건을 {@code interrupted}(reason = unmeasurable / rest / away)로 닫고
 *       누적을 0으로. 시간은 unknown/rest/away에 더한다.
 *       — FE 회신 ⑤의 "판정 불가 3초 미만은 시계 멈춤"은 {@code invalid_reason}이 생긴 뒤 D-23에서 바꾼다.</li>
 *   <li>같은 sequence 재전송·이전 sequence·겹치는 구간은 반영하지 않는다(FE 회신 ①). 시간 공백은 missing으로 더하고 사건을 끊는다.</li>
 *   <li>{@code end(at)}: 진행 중 사건을 {@code interrupted}(ended)로 닫고 {@code session_ended}를 낸다.</li>
 * </ul>
 *
 * <p>요약 정의: keep_rate = normal_ms / valid_ms, events_per_hour = collapse_count × 3,600,000 / valid_ms,
 * mean_interval_ms = 연속된 사건 시작(유효 시간 축) 간격 평균, mean_recovery_ms = 첫 알림 → 복귀 확정 평균.
 *
 * <p>스레드 안전: 모든 공개 메서드는 synchronized. 같은 세션은 같은 파티션·같은 스레드로 오지만 관리 API 조회와 겹칠 수 있다.
 *
 * <p>(D-37) {@link #snapshot()}·{@link #restore(Map)}로 판정 상태 전체(누적 시간·진행 중 사건·사건 목록·마지막 sequence)를
 * 외부 저장소(Redis)에 담았다가 api-server 재시작 뒤 그대로 이어간다.
 *
 * <p>(D-39) 제외 구간: 판정에서 뺀 시간(휴식 {@code rest}·자리 비움 {@code away}·판정 불가 {@code unmeasurable}·
 * 입력 누락 {@code missing})의 경계를 {@code excluded_started}·{@code excluded_ended} 사건으로 낸다. 판정 결과 저장이 이것으로
 * {@code excluded_interval}을 기록한다. 구간은 팀 API 판정({@code backend/api} {@code engine/Timeline})과 같다 — 붙어 있는
 * 같은 사유는 한 구간, 사유가 바뀌거나 측정 구간이 오면 끝, 세션 종료 때 열린 구간을 닫는다. 두 사건의 {@code onset_ms}는
 * 구간 시작, {@code timestamp_ms}는 시작(started)·끝(ended), {@code reason}은 사유, {@code deviation_type}은 none.
 * 사건 번호({@code event_id})는 다른 사건과 같은 순서를 쓴다.
 */
public final class V1SessionJudge {

	static final Set<String> DEVIATION_TYPES = Set.of("none", "forward_slouch", "left_lean", "right_lean",
		"unspecified");
	static final long PROGRESS_INTERVAL_MS = 1000;
	/** (D-39) 제외 구간 사유 = 사건 {@code reason} 값. 저장할 때 DB 값(PAUSE·ABSENCE·UNMEASURABLE·MISSING)으로 바꾼다. */
	static final Set<String> EXCLUSION_REASONS = Set.of("rest", "away", "unmeasurable", "missing");

	/** 관측 1개를 처리한 결과. {@code skipped}가 있으면 반영하지 않은 것. */
	public record Result(List<Map<String, Object>> decisions, Map<String, Object> progress, String skipped) {
		static Result skip(String why) {
			return new Result(List.of(), null, why);
		}
	}

	private final String sessionId;
	private final V1Policy policy;

	// 시간 누적 (세션 기준 ms)
	private long endMs;
	private long validMs;
	private long normalMs;
	private long deviationMs;
	private long restMs;
	private long awayMs;
	private long unknownMs;
	private long missingMs;
	private long holdMs;
	private long recoveryMs;
	private long onsetMs;
	private long onsetValidMs;

	// 사건 기록
	private Episode active;
	private Long previousOnsetValid;
	private long eventId;
	private long collapseCount;
	private long alertCount;
	private long intervalCount;
	private long intervalSum;
	private long recoveryCount;
	private long recoverySum;
	private final List<Map<String, Object>> events = new ArrayList<>();

	private long lastSequence = -1;
	private boolean ended;
	private long lastProgressMs;
	private long duplicates;
	private long rejected;
	private String currentDeviationType = "none";

	// (D-39) 열린 제외 구간: 사유(null이면 없음), 시작·끝(세션 기준 ms)
	private String excludedReason;
	private long excludedStartMs;
	private long excludedEndMs;

	public V1SessionJudge(String sessionId, V1Policy policy) {
		this.sessionId = sessionId;
		this.policy = policy;
	}

	private static final List<String> EVENT_KEYS = List.of("schema_version", "session_id", "event_id", "kind",
		"timestamp_ms", "onset_ms", "onset_valid_ms", "deviation_type", "reason");

	/** 스냅샷 형식 버전. 필드 의미가 바뀌면 올리고, 다른 버전은 복원하지 않는다. */
	static final int SNAPSHOT_VERSION = 1;

	/**
	 * (D-37) 판정 상태 전체를 JSON으로 옮길 수 있는 Map으로 만든다(숫자·문자열·불리언·null·List·Map만 사용).
	 */
	public synchronized Map<String, Object> snapshot() {
		Map<String, Object> snapshot = new LinkedHashMap<>();
		snapshot.put("v", SNAPSHOT_VERSION);
		snapshot.put("session_id", sessionId);
		Map<String, Object> policyValues = new LinkedHashMap<>();
		policyValues.put("hold_ms", policy.holdMs());
		policyValues.put("recovery_ms", policy.recoveryMs());
		policyValues.put("reminder_ms", policy.reminderMs());
		policyValues.put("threshold", policy.threshold());
		snapshot.put("policy", policyValues);
		snapshot.put("end_ms", endMs);
		snapshot.put("valid_ms", validMs);
		snapshot.put("normal_ms", normalMs);
		snapshot.put("deviation_ms", deviationMs);
		snapshot.put("rest_ms", restMs);
		snapshot.put("away_ms", awayMs);
		snapshot.put("unknown_ms", unknownMs);
		snapshot.put("missing_ms", missingMs);
		snapshot.put("hold_acc_ms", holdMs);
		snapshot.put("recovery_acc_ms", recoveryMs);
		snapshot.put("onset_ms", onsetMs);
		snapshot.put("onset_valid_ms", onsetValidMs);
		if (active != null) {
			Map<String, Object> activeState = new LinkedHashMap<>();
			activeState.put("onset", active.onset);
			activeState.put("onset_valid", active.onsetValid);
			activeState.put("first_alert", active.firstAlert);
			activeState.put("last_alert", active.lastAlert);
			activeState.put("type", active.type);
			snapshot.put("active", activeState);
		} else {
			snapshot.put("active", null);
		}
		snapshot.put("previous_onset_valid", previousOnsetValid);
		snapshot.put("event_id", eventId);
		snapshot.put("collapse_count", collapseCount);
		snapshot.put("alert_count", alertCount);
		snapshot.put("interval_count", intervalCount);
		snapshot.put("interval_sum", intervalSum);
		snapshot.put("recovery_count", recoveryCount);
		snapshot.put("recovery_sum", recoverySum);
		List<Map<String, Object>> ev = new ArrayList<>();
		for (Map<String, Object> e : events) {
			ev.add(new LinkedHashMap<>(e));
		}
		snapshot.put("events", ev);
		snapshot.put("last_sequence", lastSequence);
		snapshot.put("ended", ended);
		snapshot.put("last_progress_ms", lastProgressMs);
		snapshot.put("duplicates", duplicates);
		snapshot.put("rejected", rejected);
		snapshot.put("current_deviation_type", currentDeviationType);
		if (excludedReason != null) {
			Map<String, Object> excludedState = new LinkedHashMap<>();
			excludedState.put("reason", excludedReason);
			excludedState.put("start_ms", excludedStartMs);
			excludedState.put("end_ms", excludedEndMs);
			snapshot.put("excluded", excludedState);
		} else {
			snapshot.put("excluded", null);
		}
		return snapshot;
	}

	/**
	 * (D-37) {@link #snapshot()}로 만든 Map(JSON을 다시 읽은 것 — 숫자는 Integer·Long·Double 어느 것이든)에서 판정기를 되살린다.
	 *
	 * @throws IllegalArgumentException 버전이 다르거나 필수 값이 없을 때
	 */
	@SuppressWarnings("unchecked")
	public static V1SessionJudge restore(Map<String, Object> snapshot) {
		if (snapshot == null || num(snapshot.get("v"), -1) != SNAPSHOT_VERSION) {
			throw new IllegalArgumentException("스냅샷 버전이 다름: " + (snapshot == null ? null : snapshot.get("v")));
		}
		if (!(snapshot.get("session_id") instanceof String sid) || !(snapshot.get("policy") instanceof Map<?, ?> pm)) {
			throw new IllegalArgumentException("스냅샷에 session_id·policy 없음");
		}
		Map<String, Object> policyValues = (Map<String, Object>)pm;
		V1Policy policy = new V1Policy(req(policyValues, "hold_ms"), req(policyValues, "recovery_ms"),
			req(policyValues, "reminder_ms"),
			policyValues.get("threshold") instanceof Number n ? n.doubleValue() : 0.7);
		V1SessionJudge judge = new V1SessionJudge(sid, policy);
		judge.endMs = req(snapshot, "end_ms");
		judge.validMs = req(snapshot, "valid_ms");
		judge.normalMs = req(snapshot, "normal_ms");
		judge.deviationMs = req(snapshot, "deviation_ms");
		judge.restMs = req(snapshot, "rest_ms");
		judge.awayMs = req(snapshot, "away_ms");
		judge.unknownMs = req(snapshot, "unknown_ms");
		judge.missingMs = req(snapshot, "missing_ms");
		judge.holdMs = req(snapshot, "hold_acc_ms");
		judge.recoveryMs = req(snapshot, "recovery_acc_ms");
		judge.onsetMs = req(snapshot, "onset_ms");
		judge.onsetValidMs = req(snapshot, "onset_valid_ms");
		if (snapshot.get("active") instanceof Map<?, ?> am) {
			Map<String, Object> activeState = (Map<String, Object>)am;
			Episode activeEpisode = new Episode(req(activeState, "onset"), req(activeState, "onset_valid"),
				req(activeState, "first_alert"),
				activeState.get("type") instanceof String t ? t : "unspecified");
			activeEpisode.lastAlert = req(activeState, "last_alert");
			judge.active = activeEpisode;
		}
		judge.previousOnsetValid = snapshot.get("previous_onset_valid") instanceof Number n ? n.longValue() : null;
		judge.eventId = req(snapshot, "event_id");
		judge.collapseCount = req(snapshot, "collapse_count");
		judge.alertCount = req(snapshot, "alert_count");
		judge.intervalCount = req(snapshot, "interval_count");
		judge.intervalSum = req(snapshot, "interval_sum");
		judge.recoveryCount = req(snapshot, "recovery_count");
		judge.recoverySum = req(snapshot, "recovery_sum");
		if (snapshot.get("events") instanceof List<?> list) {
			for (Object o : list) {
				if (o instanceof Map<?, ?> em) {
					// 처음 만든 것과 같은 키 순서·타입(Long)으로 다시 만든다. JSON 설정이 null을 빼고 썼어도 reason 키가 남게.
					Map<String, Object> src = (Map<String, Object>)em;
					Map<String, Object> event = new LinkedHashMap<>();
					for (String k : EVENT_KEYS) {
						Object value = src.get(k);
						event.put(k, value instanceof Number n && !"schema_version".equals(k)
							? (Object)n.longValue() : value);
					}
					judge.events.add(event);
				}
			}
		}
		judge.lastSequence = req(snapshot, "last_sequence");
		judge.ended = Boolean.TRUE.equals(snapshot.get("ended"));
		judge.lastProgressMs = req(snapshot, "last_progress_ms");
		judge.duplicates = num(snapshot.get("duplicates"), 0);
		judge.rejected = num(snapshot.get("rejected"), 0);
		judge.currentDeviationType = snapshot.get("current_deviation_type") instanceof String t ? t : "none";
		// (D-39) D-39 전에 저장된 스냅샷에는 이 키가 없다 — 열린 제외 구간 없음으로 이어간다(그 세션의 구간은 다음 경계부터 기록).
		if (snapshot.get("excluded") instanceof Map<?, ?> xm && xm.get("reason") instanceof String r
			&& EXCLUSION_REASONS.contains(r)) {
			Map<String, Object> excludedState = (Map<String, Object>)xm;
			judge.excludedReason = r;
			judge.excludedStartMs = req(excludedState, "start_ms");
			judge.excludedEndMs = req(excludedState, "end_ms");
		}
		return judge;
	}

	private static long req(Map<String, Object> values, String key) {
		if (!(values.get(key) instanceof Number n)) {
			throw new IllegalArgumentException("스냅샷에 " + key + " 없음");
		}
		return n.longValue();
	}

	private static long num(Object value, long fallback) {
		return value instanceof Number n ? n.longValue() : fallback;
	}

	public synchronized Result accept(V1Observation observation) {
		if (ended) {
			rejected++;
			return Result.skip("세션 종료 후 관측");
		}
		if (observation.sequence() <= lastSequence) {
			duplicates++;
			return Result.skip("이미 반영한 sequence " + observation.sequence() + " (마지막 " + lastSequence + ")");
		}
		if (observation.startMs() < endMs) {
			rejected++;
			return Result.skip("구간 겹침 start_ms " + observation.startMs() + " < 마지막 end_ms " + endMs);
		}
		List<Map<String, Object>> emitted = new ArrayList<>();

		if (observation.startMs() > endMs) {
			interrupt("missing", endMs, emitted);
			missingMs += observation.startMs() - endMs;
			exclude("missing", endMs, observation.startMs(), emitted);
		} else if (lastSequence >= 0 && observation.sequence() != lastSequence + 1) {
			interrupt("missing_sequence", endMs, emitted);
		}

		currentDeviationType = DEVIATION_TYPES.contains(observation.deviationType())
			? observation.deviationType() : "unspecified";
		long durationMs = observation.durationMs();
		if (!"running".equals(observation.phase()) || !observation.valid()) {
			String reason = "running".equals(observation.phase()) ? "unmeasurable" : observation.phase();
			interrupt(reason, observation.startMs(), emitted);
			exclude(reason, observation.startMs(), observation.endMs(), emitted);
			endMs = observation.endMs();
			switch (observation.phase()) {
				case "rest" -> restMs += durationMs;
				case "away" -> awayMs += durationMs;
				default -> unknownMs += durationMs;
			}
		} else {
			closeExcluded(emitted);
			boolean candidate = observation.collapseProbability() >= policy.threshold();
			endMs = observation.endMs();
			if (candidate && holdMs == 0) {
				onsetMs = observation.startMs();
				onsetValidMs = validMs;
			}
			validMs += durationMs;
			if (candidate) {
				deviationMs += durationMs;
				holdMs += durationMs;
				recoveryMs = 0;
			} else {
				normalMs += durationMs;
				holdMs = 0;
				recoveryMs += durationMs;
			}
			if (candidate && active == null && holdMs >= policy.holdMs()) {
				confirmCollapse(emitted);
			} else if (!candidate && active != null && recoveryMs >= policy.recoveryMs()) {
				confirmRecovery(emitted);
			} else if (candidate && active != null && endMs - active.lastAlert >= policy.reminderMs()) {
				remind(emitted);
			}
		}
		lastSequence = observation.sequence();

		Map<String, Object> summary = summary();
		List<Map<String, Object>> decisions = new ArrayList<>();
		for (Map<String, Object> event : emitted) {
			decisions.add(decisionBody(event, summary));
		}
		Map<String, Object> progress = null;
		if (endMs - lastProgressMs >= PROGRESS_INTERVAL_MS) {
			progress = progressBody(summary);
			lastProgressMs = endMs;
		}
		return new Result(decisions, progress, null);
	}

	/** {@code session_ended}(end_ms) 처리. 이미 끝났으면 건너뜀. */
	public synchronized Result end(long atMs) {
		if (ended) {
			duplicates++;
			return Result.skip("이미 종료된 세션");
		}
		List<Map<String, Object>> emitted = new ArrayList<>();
		long at = Math.max(atMs, endMs);
		if (at > endMs) {
			interrupt("missing", endMs, emitted);
			missingMs += at - endMs;
			exclude("missing", endMs, at, emitted);
		}
		interrupt("ended", endMs, emitted);
		closeExcluded(emitted);
		endMs = at;
		ended = true;
		emitted.add(event("session_ended", at, at, validMs, "none", "ended"));
		Map<String, Object> summary = summary();
		List<Map<String, Object>> decisions = new ArrayList<>();
		for (Map<String, Object> event : emitted) {
			decisions.add(decisionBody(event, summary));
		}
		lastProgressMs = endMs;
		return new Result(decisions, progressBody(summary), null);
	}

	/**
	 * 입력이 끊긴 채 만료될 때: 진행 중 사건을 끊김(missing)으로 닫고, 세션도 {@code session_ended}(reason = missing)로 끝낸다.
	 * (D-30) 판정 결과 저장이 세션 종료 사유를 {@code DISCONNECTED}로 기록할 수 있게 — 사용자 종료는 reason = ended.
	 */
	public synchronized Result expire() {
		if (ended) {
			return Result.skip("이미 종료된 세션");
		}
		List<Map<String, Object>> emitted = new ArrayList<>();
		interrupt("missing", endMs, emitted);
		closeExcluded(emitted);
		ended = true;
		emitted.add(event("session_ended", endMs, endMs, validMs, "none", "missing"));
		Map<String, Object> summary = summary();
		List<Map<String, Object>> decisions = new ArrayList<>();
		for (Map<String, Object> event : emitted) {
			decisions.add(decisionBody(event, summary));
		}
		lastProgressMs = endMs;
		return new Result(decisions, progressBody(summary), null);
	}

	public synchronized boolean ended() {
		return ended;
	}

	public synchronized boolean hasInput() {
		return lastSequence >= 0;
	}

	/** 관리 API용 현재 상태. */
	public synchronized Map<String, Object> view() {
		Map<String, Object> view = new LinkedHashMap<>();
		view.put("session_id", sessionId);
		Map<String, Object> policyValues = new LinkedHashMap<>();
		policyValues.put("hold_ms", policy.holdMs());
		policyValues.put("recovery_ms", policy.recoveryMs());
		policyValues.put("reminder_ms", policy.reminderMs());
		policyValues.put("threshold", policy.threshold());
		view.put("policy", policyValues);
		view.put("ended", ended);
		view.put("active", active != null);
		view.put("last_sequence", lastSequence);
		view.put("summary", summary());
		view.put("events", List.copyOf(events));
		view.put("duplicates_ignored", duplicates);
		view.put("rejected", rejected);
		return view;
	}

	// ------------------------------------------------------------------

	private void confirmCollapse(List<Map<String, Object>> out) {
		active = new Episode(onsetMs, onsetValidMs, endMs, currentDeviationType);
		collapseCount++;
		alertCount++;
		if (previousOnsetValid != null) {
			intervalCount++;
			intervalSum += onsetValidMs - previousOnsetValid;
		}
		previousOnsetValid = onsetValidMs;
		out.add(episodeEvent("collapse_confirmed", endMs, null));
	}

	private void remind(List<Map<String, Object>> out) {
		alertCount++;
		active.lastAlert = endMs;
		out.add(episodeEvent("reminder", endMs, null));
	}

	private void confirmRecovery(List<Map<String, Object>> out) {
		recoveryCount++;
		recoverySum += endMs - active.firstAlert;
		out.add(episodeEvent("recovery_confirmed", endMs, null));
		active = null;
		recoveryMs = 0;
	}

	private void interrupt(String reason, long at, List<Map<String, Object>> out) {
		if (active != null) {
			out.add(episodeEvent("interrupted", at, reason));
		}
		active = null;
		holdMs = 0;
		recoveryMs = 0;
	}

	/**
	 * (D-39) [from, to) 구간을 제외 구간에 넣는다. 열린 구간과 사유가 같고 바로 이어지면 늘리기만 하고(사건 없음),
	 * 아니면 열린 구간을 닫고({@code excluded_ended}) 새 구간을 연다({@code excluded_started}).
	 */
	private void exclude(String reason, long from, long to, List<Map<String, Object>> out) {
		if (excludedReason != null && excludedReason.equals(reason) && excludedEndMs == from) {
			excludedEndMs = to;
			return;
		}
		closeExcluded(out);
		excludedReason = reason;
		excludedStartMs = from;
		excludedEndMs = to;
		out.add(event("excluded_started", from, from, validMs, "none", reason));
	}

	/** (D-39) 열린 제외 구간이 있으면 그 끝 시각으로 닫는다. */
	private void closeExcluded(List<Map<String, Object>> out) {
		if (excludedReason == null) {
			return;
		}
		out.add(event("excluded_ended", excludedEndMs, excludedStartMs, validMs, "none", excludedReason));
		excludedReason = null;
	}

	private Map<String, Object> episodeEvent(String kind, long at, String reason) {
		return event(kind, at, active.onset, active.onsetValid, active.type, reason);
	}

	private Map<String, Object> event(String kind, long at, long onset, long onsetValid, String type, String reason) {
		Map<String, Object> event = new LinkedHashMap<>();
		event.put("schema_version", "1.0");
		event.put("session_id", sessionId);
		event.put("event_id", ++eventId);
		event.put("kind", kind);
		event.put("timestamp_ms", at);
		event.put("onset_ms", onset);
		event.put("onset_valid_ms", onsetValid);
		event.put("deviation_type", type);
		event.put("reason", reason);
		events.add(event);
		return event;
	}

	private Map<String, Object> decisionBody(Map<String, Object> event, Map<String, Object> summary) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("last_sequence", lastSequence);
		body.put("event", event);
		body.put("summary", summary);
		return body;
	}

	private Map<String, Object> progressBody(Map<String, Object> summary) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("last_sequence", lastSequence);
		body.put("summary", summary);
		return body;
	}

	Map<String, Object> summary() {
		Map<String, Object> summary = new LinkedHashMap<>();
		summary.put("total_ms", endMs);
		summary.put("valid_ms", validMs);
		summary.put("normal_ms", normalMs);
		summary.put("deviation_ms", deviationMs);
		summary.put("rest_ms", restMs);
		summary.put("away_ms", awayMs);
		summary.put("unknown_ms", unknownMs);
		summary.put("missing_ms", missingMs);
		summary.put("collapse_count", collapseCount);
		summary.put("alert_count", alertCount);
		summary.put("interval_count", intervalCount);
		summary.put("keep_rate", validMs == 0 ? null : (double)normalMs / validMs);
		summary.put("events_per_hour", validMs == 0 ? null : collapseCount * 3_600_000.0 / validMs);
		summary.put("mean_interval_ms", intervalCount == 0 ? null : (double)intervalSum / intervalCount);
		summary.put("mean_recovery_ms", recoveryCount == 0 ? null : (double)recoverySum / recoveryCount);
		return summary;
	}

	private static final class Episode {
		final long onset;
		final long onsetValid;
		final long firstAlert;
		final String type;
		long lastAlert;

		Episode(long onset, long onsetValid, long at, String type) {
			this.onset = onset;
			this.onsetValid = onsetValid;
			this.firstAlert = at;
			this.lastAlert = at;
			this.type = type;
		}
	}
}
