package org.posegood.api.web;

import static org.mockito.Mockito.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.Observation;
import org.posegood.contracts.Policy;
import org.posegood.contracts.SessionView;
import org.posegood.contracts.Summary;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

@SpringBootTest
@AutoConfigureMockMvc
class FeatureContractTest {
    private static final String POLICY_JSON =
            """
            {"policy":{"hold_ms":3000,"recovery_ms":2000,"reminder_ms":60000,"threshold":0.7}}
            """;
    private static final String FEATURE_JSON =
            """
            {
              "schema_version": "2.0",
              "feature_version": "shoulder-relative-deltas-v1",
              "baseline_id": "11111111-1111-1111-1111-111111111111",
              "sequence": 0,
              "start_ms": 0,
              "end_ms": 1000,
              "phase": "running",
              "measurement_quality": "good",
              "features": {
                "head_gap_delta": 0.0,
                "lateral_offset_delta": 0.2,
                "shoulder_tilt_delta": 0.0,
                "current_quality": 0.9,
                "baseline_quality": 0.9
              }
            }
            """;
    @Autowired MockMvc mvc;
    @MockitoBean CepGateway cep;
    @MockitoBean InferenceGateway inference;
    private UUID id;

    @BeforeEach
    void setup() {
        id = UUID.randomUUID();
        reset(cep, inference);
    }

    private SessionView view(long sequence, long totalMs) {
        return new SessionView(
                "1.0",
                id,
                Policy.defaults(),
                "legacy-interrupt-v1",
                false,
                sequence,
                new Summary(
                        totalMs,
                        totalMs,
                        0,
                        totalMs,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        totalMs == 0 ? null : 0.0,
                        totalMs == 0 ? null : 0.0,
                        0,
                        null,
                        null),
                List.of());
    }

    private Observation observation(Observation.Phase phase, boolean valid) {
        return new Observation(
                "2.0",
                0,
                0,
                1000,
                phase,
                valid,
                valid ? 0.7 : 0,
                valid ? Observation.DeviationType.left_lean : Observation.DeviationType.none,
                "reference-feature-rule-v1");
    }

    private void create() throws Exception {
        when(cep.create(eq(id), any())).thenReturn(view(-1, 0));
        mvc.perform(put("/v1/sessions/" + id).contentType("application/json").content(POLICY_JSON))
                .andExpect(status().isOk());
        clearInvocations(cep, inference);
    }

    @Test
    void returnsVersionedObservationAndSessionEnvelopeAndRetriesOnce() throws Exception {
        create();
        when(inference.infer(any())).thenReturn(observation(Observation.Phase.running, true));
        when(cep.observe(eq(id), any())).thenReturn(view(0, 1000));
        for (int attempt = 0; attempt < 2; attempt++) {
            mvc.perform(
                            post("/v1/sessions/" + id + "/features")
                                    .contentType("application/json")
                                    .content(FEATURE_JSON))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.schema_version").value("1.0"))
                    .andExpect(jsonPath("$.observation.schema_version").value("2.0"))
                    .andExpect(jsonPath("$.observation.collapse_probability").value(0.7))
                    .andExpect(jsonPath("$.observation.deviation_type").value("left_lean"))
                    .andExpect(
                            jsonPath("$.observation.model_version")
                                    .value("reference-feature-rule-v1"))
                    .andExpect(jsonPath("$.session.session_id").value(id.toString()))
                    .andExpect(jsonPath("$.session.last_sequence").value(0))
                    .andExpect(jsonPath("$.features").doesNotExist())
                    .andExpect(jsonPath("$.baseline_id").doesNotExist());
        }
        verify(inference, times(1)).infer(any());
        verify(cep, times(1)).observe(eq(id), any());
    }

    @Test
    void rejectsMissingNullUnknownMalformedAndInvalidIntervalsBeforeInference() throws Exception {
        create();
        for (var body :
                List.of(
                        "{}",
                        FEATURE_JSON.replace("\"features\": {", "\"unexpected\": {"),
                        FEATURE_JSON.replace(
                                "\"schema_version\": \"2.0\"", "\"schema_version\": \"1.0\""),
                        FEATURE_JSON.replace(
                                "\"feature_version\": \"shoulder-relative-deltas-v1\"",
                                "\"feature_version\": null"),
                        FEATURE_JSON.replace("11111111-1111-1111-1111-111111111111", "1-1-1-1-1"),
                        FEATURE_JSON.replace(
                                "11111111-1111-1111-1111-111111111111", "EREREREREREREREREREREQ=="),
                        FEATURE_JSON.replace(
                                "\"baseline_id\": \"11111111-1111-1111-1111-111111111111\"",
                                "\"baseline_id\": null"),
                        FEATURE_JSON.replace("\"end_ms\": 1000", "\"end_ms\": 1501"),
                        FEATURE_JSON.replace("\"end_ms\": 1000", "\"end_ms\": 0"),
                        FEATURE_JSON.replace("\"sequence\": 0,", ""),
                        FEATURE_JSON.replace("\"head_gap_delta\": 0.0,", ""),
                        FEATURE_JSON.replace("\"phase\": \"running\"", "\"phase\": \"unknown\""),
                        FEATURE_JSON.replace(
                                "\"measurement_quality\": \"good\"",
                                "\"measurement_quality\": \"bad\""),
                        FEATURE_JSON.replace(
                                "\"sequence\": 0", "\"sequence\": 0,\"sequence\": 1"))) {
            mvc.perform(
                            post("/v1/sessions/" + id + "/features")
                                    .contentType("application/json")
                                    .content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(inference, cep);
    }

    @Test
    void rejectsNonfiniteOutOfRangeAndCoercedNumbersBeforeInference() throws Exception {
        create();
        for (var body :
                List.of(
                        FEATURE_JSON.replace(
                                "\"head_gap_delta\": 0.0", "\"head_gap_delta\": 1e309"),
                        FEATURE_JSON.replace(
                                "\"head_gap_delta\": 0.0", "\"head_gap_delta\": \"NaN\""),
                        FEATURE_JSON.replace(
                                "\"head_gap_delta\": 0.0", "\"head_gap_delta\": \"0.0\""),
                        FEATURE_JSON.replace(
                                "\"current_quality\": 0.9", "\"current_quality\": -0.1"),
                        FEATURE_JSON.replace(
                                "\"baseline_quality\": 0.9", "\"baseline_quality\": 1.01"),
                        FEATURE_JSON.replace(
                                "\"current_quality\": 0.9", "\"current_quality\": null"),
                        FEATURE_JSON.replace("\"sequence\": 0", "\"sequence\": 0.5"))) {
            mvc.perform(
                            post("/v1/sessions/" + id + "/features")
                                    .contentType("application/json")
                                    .content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(inference, cep);
    }

    @Test
    void lowQualityAndUnboundedFiniteDeltasRemainValidContractInputs() throws Exception {
        create();
        when(inference.infer(any())).thenReturn(observation(Observation.Phase.running, false));
        when(cep.observe(eq(id), any())).thenReturn(view(0, 1000));
        var body =
                FEATURE_JSON
                        .replace("\"current_quality\": 0.9", "\"current_quality\": 0.649999")
                        .replace("\"head_gap_delta\": 0.0", "\"head_gap_delta\": 1e308");
        mvc.perform(
                        post("/v1/sessions/" + id + "/features")
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.observation.valid").value(false))
                .andExpect(jsonPath("$.observation.collapse_probability").value(0));
    }

    @Test
    void acceptsCanonicalUuidCaseWithoutVersionOrVariantRestrictions() throws Exception {
        create();
        when(inference.infer(any())).thenReturn(observation(Observation.Phase.running, true));
        when(cep.observe(eq(id), any())).thenReturn(view(0, 1000));
        var body =
                FEATURE_JSON.replace(
                        "11111111-1111-1111-1111-111111111111",
                        "ABCDEFAB-CDEF-0000-0000-ABCDEFABCDEF");
        mvc.perform(
                        post("/v1/sessions/" + id + "/features")
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isOk());
        verify(inference, times(1)).infer(any());
    }

    @Test
    void restControlIntervalAllowsExplicitNullFeatures() throws Exception {
        create();
        when(inference.infer(any())).thenReturn(observation(Observation.Phase.rest, false));
        when(cep.observe(eq(id), any())).thenReturn(view(0, 1000));
        var body =
                """
                {
                  "schema_version":"2.0","feature_version":"shoulder-relative-deltas-v1",
                  "baseline_id":"11111111-1111-1111-1111-111111111111",
                  "sequence":0,"start_ms":0,"end_ms":1000,"phase":"rest",
                  "measurement_quality":"poor","features":null
                }
                """;
        mvc.perform(
                        post("/v1/sessions/" + id + "/features")
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.observation.phase").value("rest"))
                .andExpect(jsonPath("$.observation.valid").value(false));
    }

    @Test
    void upstreamFailurePreservesSnapshotAndRetryUsesExactObservation() throws Exception {
        create();
        when(inference.infer(any())).thenReturn(observation(Observation.Phase.running, true));
        when(cep.observe(eq(id), any()))
                .thenThrow(new ContractError(502, "unavailable"))
                .thenReturn(view(0, 1000));
        mvc.perform(
                        post("/v1/sessions/" + id + "/features")
                                .contentType("application/json")
                                .content(FEATURE_JSON))
                .andExpect(status().isBadGateway());
        mvc.perform(get("/v1/sessions/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.last_sequence").value(-1));
        mvc.perform(
                        post("/v1/sessions/" + id + "/end")
                                .contentType("application/json")
                                .content("{\"end_ms\":0}"))
                .andExpect(status().isConflict());
        mvc.perform(
                        post("/v1/sessions/" + id + "/features")
                                .contentType("application/json")
                                .content(FEATURE_JSON))
                .andExpect(status().isOk());
        verify(inference, times(1)).infer(any());
        verify(cep, times(2)).observe(eq(id), any());
    }
}
