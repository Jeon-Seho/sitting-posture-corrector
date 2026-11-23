package org.posegood.api.contract;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.posegood.api.common.Json;

import com.fasterxml.jackson.annotation.JsonCreator;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * 앱이 보내는 좌표 구간 하나: 보통 프레임 1장이고 다음 프레임이 찍힐 때 끝난다(2026-10-27부터 프레임마다, 약 0.1초).
 * 새 프레임이 0.5초 동안 없으면 0.5초에서 닫는다. 관절 9개 원본 프레임이다. {@code /realtime} features의 item이다.
 *
 * 계약: contracts/realtime/frames/posture-frames.schema.json. 구간은 [startMs, endMs)이다.
 * 좌표는 로그·DB에 남기지 않는다. Kafka 적재 스위치를 켠 경우에만 별도 좌표 토픽으로 보낸다.
 */
public record FrameInterval(
	@NotNull @Pattern(regexp = "3\\.0") String schemaVersion,
	@NotNull @Pattern(regexp = "keypoints-9-v1") String featureVersion,
	@PositiveOrZero long sequence,
	@PositiveOrZero @Max(86400000) long startMs,
	@Positive @Max(86400000) long endMs,
	@NotNull Phase phase,
	@NotNull @Size(max = 30) List<@NotNull @Valid Frame> frames) {

	/** 관절 수: MediaPipe 0·2·5·7·8·9·10·11·12(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨). */
	public static final int JOINTS = 9;

	public enum Phase {
		running,
		rest,
		away
	}

	public FrameInterval {
		if (endMs <= startMs || endMs - startMs > 1500) {
			throw new IllegalArgumentException("interval must be 1..1500ms");
		}
	}

	/** 구형 배열도 평균 없이 마지막 관측 한 장으로 처리한다. */
	public Frame lastFrame() {
		return frames.isEmpty() ? null : frames.get(frames.size() - 1);
	}

	/** 평탄화 WS 입력. 내부 추론 계약의 phase와 품질 표현은 유지한다. */
	public static FrameInterval readFlat(JsonNode node) {
		var allowed = Set.of("type", "sequence", "start_ms", "end_ms", "phase", "t_ms", "p");
		for (String name : node.propertyNames()) {
			if (!allowed.contains(name)) {
				throw new IllegalArgumentException("unknown interval field");
			}
		}
		if (!"features".equals(Json.text(node.path("type")))) {
			throw new IllegalArgumentException("features required");
		}
		long sequence = integer(node.path("sequence"));
		long start = integer(node.path("start_ms"));
		long end = integer(node.path("end_ms"));
		String phase = Json.text(node.path("phase"));
		var frames = List.<Frame>of();
		if ("running".equals(phase) || "unmeasurable".equals(phase)) {
			var points = node.get("p");
			boolean running = "running".equals(phase);
			if (points == null || (running ? !points.isArray() : !points.isNull())
				|| (running && !node.has("t_ms"))) {
				throw new IllegalArgumentException("invalid frame fields");
			}
			if (node.has("t_ms")) {
				long time = integer(node.get("t_ms"));
				if (time < start || time >= end) {
					throw new IllegalArgumentException("frame outside interval");
				}
				var frame = JsonNodeFactory.instance.objectNode();
				frame.put("t_ms", time);
				frame.set("p", points);
				frames = List.of(Frame.read(frame));
			}
			phase = "running";
		} else if ((!"rest".equals(phase) && !"away".equals(phase)) || node.has("t_ms") || node.has("p")) {
			throw new IllegalArgumentException("invalid phase fields");
		}
		return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, end, Phase.valueOf(phase), frames);
	}

	private static long integer(JsonNode node) {
		if (!node.isIntegralNumber() || !node.canConvertToLong() || node.asLong() < 0) {
			throw new IllegalArgumentException("nonnegative integer required");
		}
		return node.asLong();
	}

	/**
	 * 자정 넘김 뒤: 앱이 연결 기준으로 보낸 시간·순번에서 {@code ms}·{@code sequences}를 빼 새 세션 기준으로 옮긴다.
	 * 프레임 {@code t_ms}는 판정에 쓰지 않아 그대로 둔다.
	 */
	public FrameInterval shifted(long ms, long sequences) {
		if (ms == 0 && sequences == 0) {
			return this;
		}
		return new FrameInterval(
			schemaVersion, featureVersion, sequence - sequences, startMs - ms, endMs - ms, phase, frames);
	}

	/**
	 * 프레임 하나. {@code p}는 관절 9개 {@code [x, y, visibility]} 또는 사람이 없으면 null.
	 *
	 * {@code valid:false}는 앱이 위치를 판별하지 못한 프레임에만 붙는다(없으면 null).
	 */
	public record Frame(@PositiveOrZero long tMs, List<List<Double>> p, Boolean valid) {
		public Frame {
			if (Boolean.TRUE.equals(valid)) {
				throw new IllegalArgumentException("valid may only be false");
			}
			if (p != null) {
				if (p.size() != JOINTS) {
					throw new IllegalArgumentException("9 joints required");
				}
				for (var joint : p) {
					if (joint == null
						|| joint.size() != 3
						|| joint.get(0) == null
						|| joint.get(1) == null
						|| joint.get(2) == null) {
						throw new IllegalArgumentException("joint must be [x, y, visibility]");
					}
					double xCoordinate = joint.get(0);
					double yCoordinate = joint.get(1);
					double visibility = joint.get(2);
					if (!(xCoordinate >= -1 && xCoordinate <= 2)
						|| !(yCoordinate >= -1 && yCoordinate <= 2) || !(visibility >= 0 && visibility <= 1)) {
						throw new IllegalArgumentException("joint out of range");
					}
				}
				p = List.copyOf(p.stream().map(List::copyOf).toList());
			}
		}

		private static final Set<String> FIELDS = Set.of("t_ms", "p", "valid");

		/**
		 * JSON 읽기. {@code valid}는 빠질 수 있어 creator 속성 누락 검사(application.properties) 대신 여기서 같은
		 * 엄격함으로 읽는다: 모르는 키·문자열 숫자·소수 t_ms는 거절한다.
		 */
		@JsonCreator(mode = JsonCreator.Mode.DELEGATING)
		static Frame read(JsonNode node) {
			if (!node.isObject()) {
				throw new IllegalArgumentException("frame must be an object");
			}
			for (String name : node.propertyNames()) {
				if (!FIELDS.contains(name)) {
					throw new IllegalArgumentException("unknown frame field");
				}
			}
			var timestampNode = node.get("t_ms");
			var pointsNode = node.get("p");
			var valid = node.get("valid");
			if (timestampNode == null || !timestampNode.isIntegralNumber()
				|| !timestampNode.canConvertToLong() || pointsNode == null) {
				throw new IllegalArgumentException("t_ms and p are required");
			}
			List<List<Double>> points = null;
			if (!pointsNode.isNull()) {
				if (!pointsNode.isArray()) {
					throw new IllegalArgumentException("p must be an array");
				}
				points = new ArrayList<>();
				for (var joint : pointsNode) {
					if (!joint.isArray()) {
						throw new IllegalArgumentException("joint must be an array");
					}
					var values = new ArrayList<Double>();
					for (var value : joint) {
						if (!value.isNumber()) {
							throw new IllegalArgumentException("joint values must be numbers");
						}
						values.add(value.asDouble());
					}
					points.add(values);
				}
			}
			if (valid != null && !valid.isBoolean()) {
				throw new IllegalArgumentException("valid must be false");
			}
			return new Frame(timestampNode.asLong(), points, valid == null ? null : valid.asBoolean());
		}

		/** 판정에 쓸 수 있는 후보: 사람이 있고 앱이 판정 불가로 표시하지 않았다. */
		public boolean tracked() {
			return p != null && valid == null;
		}

		/** 관절 {@code index}의 {@code [x, y, visibility]}. */
		public double[] joint(int index) {
			var joint = p.get(index);
			return new double[] {joint.get(0), joint.get(1), joint.get(2)};
		}
	}
}
