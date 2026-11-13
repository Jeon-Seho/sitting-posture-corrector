package org.posegood.api.workspace;

import java.util.ArrayList;
import java.util.List;

import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.posegood.api.session.SessionService;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

/** 기록 목록 조회: 닫힌 세션들({@link ClosedSessions})을 앱 기록 형식으로 만든다. */
@Component
class RecordHistory {
	private final ClosedSessions closed;
	private final Json json;
	private final SessionService sessions;

	RecordHistory(ClosedSessions closed, Json json, SessionService sessions) {
		this.closed = closed;
		this.json = json;
		this.sessions = sessions;
	}

	/** 사용자의 기록 목록(최신순). */
	List<JsonNode> list(long owner) {
		var rows = closed.load(owner, null);
		String model = sessions.modelVersion();
		var records = new ArrayList<JsonNode>(rows.size());
		for (var session : rows) {
			var view = session.view();
			records.add(
				RecordRebuild.record(
					session.id().toString(),
					KstTime.instant(session.startedAt()).toString(),
					KstTime.instant(session.endedAt()).toString(),
					session.rules(),
					session.calibration(),
					session.endReason(),
					view,
					model,
					view == null ? null : json.tree(view)));
		}
		return records;
	}
}
