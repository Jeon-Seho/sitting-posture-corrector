package com.posture.api.posture.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.apache.kafka.clients.admin.NewTopic;
import org.junit.jupiter.api.Test;

/** (D-82) 토픽을 새로 만들 때 들어가는 보존·세그먼트 설정. */
class RealtimeTopicsConfigTest {
	private final RealtimeTopicsConfig config = new RealtimeTopicsConfig();

	@Test
	void realtimeTopicsKeepThreeDaysWithOneDaySegments() {
		List<NewTopic> topics = List.of(
			config.postureFeaturesTopic("posture.features", 3),
			config.postureInferenceTopic("posture.inference", 3),
			config.postureEpisodesTopic("posture.episodes", 3),
			config.postureAlertsTopic("posture.alerts", 3),
			config.postureStoredTopic("posture.stored", 3),
			config.postureKeypointsTopic("posture.keypoints", 3)
		);

		for (NewTopic topic : topics) {
			assertThat(topic.numPartitions()).isEqualTo(3);
			assertThat(topic.configs())
				.containsEntry("retention.ms", "259200000")
				.containsEntry("segment.ms", "86400000");
		}
	}

	@Test
	void deadLetterTopicKeepsSevenDaysWithOneDaySegments() {
		NewTopic dlq = config.postureDlqTopic("posture.dlq");
		assertThat(dlq.numPartitions()).isEqualTo(1);
		assertThat(dlq.configs())
			.containsEntry("retention.ms", "604800000")
			.containsEntry("segment.ms", "86400000");
	}
}
