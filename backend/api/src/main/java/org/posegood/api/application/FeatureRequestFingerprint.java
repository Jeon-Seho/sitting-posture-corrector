package org.posegood.api.application;

import org.posegood.contracts.InferenceRequest;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Compares retries without retaining or logging their feature values. */
final class FeatureRequestFingerprint {
    private FeatureRequestFingerprint() {}

    static String of(InferenceRequest request) {
        try {
            var bytes = new ByteArrayOutputStream();
            try (var output = new DataOutputStream(bytes)) {
                output.writeUTF(request.schemaVersion());
                output.writeUTF(request.featureVersion());
                output.writeUTF(request.baselineId().toString());
                output.writeLong(request.sequence());
                output.writeLong(request.startMs());
                output.writeLong(request.endMs());
                output.writeUTF(request.phase().name());
                output.writeUTF(request.measurementQuality().name());
                output.writeBoolean(request.features() != null);
                if (request.features() != null) {
                    var features = request.features();
                    output.writeDouble(features.headGapDelta());
                    output.writeDouble(features.lateralOffsetDelta());
                    output.writeDouble(features.shoulderTiltDelta());
                    output.writeDouble(features.currentQuality());
                    output.writeDouble(features.baselineQuality());
                }
            }
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException error) {
            throw new IllegalStateException("cannot fingerprint feature request", error);
        }
    }
}
