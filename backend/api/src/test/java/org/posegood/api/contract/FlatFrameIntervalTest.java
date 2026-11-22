package org.posegood.api.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 신형 입력의 phase·좌표·시각 조합과 구형에 영향을 주지 않는 경계를 확인한다. */
class FlatFrameIntervalTest {
	private static final JsonMapper JSON = JsonMapper.builder().build();
	private static final Path EXAMPLES = Path.of("..", "..", "contracts", "realtime", "examples-ws");

	private static ObjectNode example(String name) throws Exception {
		return (ObjectNode)JSON.readTree(Files.readString(EXAMPLES.resolve(name)));
	}

	@Test
	void everyPhaseNormalizesToTheExistingInternalContract() throws Exception {
		var running = FrameInterval.readFlat(example("ws-features.json"));
		assertEquals(FrameInterval.Phase.running, running.phase());
		assertEquals(9, running.lastFrame().p().size());
		var unmeasurable = FrameInterval.readFlat(example("ws-unmeasurable.json"));
		assertEquals(FrameInterval.Phase.running, unmeasurable.phase());
		assertNull(unmeasurable.lastFrame().p());
		assertTrue(FrameInterval.readFlat(example("ws-no-observation.json")).frames().isEmpty());
		assertEquals(FrameInterval.Phase.rest, FrameInterval.readFlat(example("ws-rest.json")).phase());
		assertEquals(FrameInterval.Phase.away, FrameInterval.readFlat(example("ws-away.json")).phase());
	}

	@Test
	void captureTimeMustBeInsideTheFlatInterval() throws Exception {
		var message = example("ws-features.json");
		long start = message.path("start_ms").asLong();
		long end = message.path("end_ms").asLong();
		FrameInterval.readFlat(message.put("t_ms", start));
		FrameInterval.readFlat(message.put("t_ms", end - 1));
		for (long time : new long[] {start - 1, end}) {
			message.put("t_ms", time);
			assertThrows(IllegalArgumentException.class, () -> FrameInterval.readFlat(message));
		}
	}

	@Test
	void malformedAndMixedShapesAreRejected() throws Exception {
		var normal = example("ws-features.json");
		var noPoints = normal.deepCopy();
		noPoints.putNull("p");
		var noTime = normal.deepCopy();
		noTime.remove("t_ms");
		var mixed = normal.deepCopy();
		mixed.putArray("items");
		var wrongPhase = normal.deepCopy();
		wrongPhase.put("phase", "calibration");
		var nullTime = example("ws-no-observation.json").putNull("t_ms");
		var restPoints = example("ws-rest.json").putNull("p");
		var fractional = normal.deepCopy().put("sequence", 1.5);
		var missingPhase = normal.deepCopy();
		missingPhase.remove("phase");
		var invalid = List.of(noPoints, noTime, mixed, wrongPhase, nullTime, restPoints, fractional, missingPhase);
		for (var message : invalid) {
			assertThrows(IllegalArgumentException.class, () -> FrameInterval.readFlat(message));
		}
	}
}
