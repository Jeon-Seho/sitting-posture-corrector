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
import org.posegood.contracts.ContractError;
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
class ApiContractTest {
    @Autowired MockMvc mvc;
    @MockitoBean CepGateway gateway;
    private UUID id;
    private static final String POLICY_JSON =
            """
            {
              "policy": {
                "hold_ms": 3000,
                "recovery_ms": 2000,
                "reminder_ms": 60000,
                "threshold": 0.7
              }
            }
            """
                    .strip();

    private static final String OBSERVATION_JSON =
            """
            {
              "schema_version": "2.0",
              "sequence": 0,
              "start_ms": 0,
              "end_ms": 1000,
              "phase": "running",
              "valid": true,
              "collapse_probability": 0.9,
              "deviation_type": "forward_slouch",
              "model_version": "synthetic-v1"
            }
            """;

    @BeforeEach
    void setup() {
        id = UUID.randomUUID();
        reset(gateway);
    }

    private SessionView view() {
        return new SessionView(
                "1.0",
                id,
                Policy.defaults(),
                "legacy-interrupt-v1",
                false,
                -1,
                new Summary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, 0, null, null),
                List.of());
    }

    private void create() throws Exception {
        when(gateway.create(eq(id), any())).thenReturn(view());
        mvc.perform(put("/v1/sessions/" + id).contentType("application/json").content(POLICY_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void acceptedInputIsDelegatedAndReadFromSavedSnapshot() throws Exception {
        create();
        when(gateway.observe(eq(id), any())).thenReturn(view());
        mvc.perform(
                        post("/v1/sessions/" + id + "/observations")
                                .contentType("application/json")
                                .content(OBSERVATION_JSON))
                .andExpect(status().isOk());
        verify(gateway, times(1)).observe(eq(id), any());
        mvc.perform(get("/v1/sessions/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.keep_rate").isEmpty());
    }

    @Test
    void unknownFieldsNullMissingInvalidTimesAndDuplicateKeysAreRejected() throws Exception {
        for (var body :
                List.of(
                        "{}",
                        "{\"policy\":null}",
                        POLICY_JSON.replace("3000", "0"),
                        POLICY_JSON.replace("3000", "-1"),
                        POLICY_JSON.substring(0, POLICY_JSON.length() - 1)
                                + ",\"password\":\"synthetic-forbidden\"}",
                        POLICY_JSON.replace("\"hold_ms\": 3000,", ""),
                        POLICY_JSON.replace(
                                "\"hold_ms\": 3000", "\"hold_ms\": 3000,\"hold_ms\": 4000"))) {
            mvc.perform(put("/v1/sessions/" + id).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(gateway);
    }

    @Test
    void missingObservationValidityIsRejectedRatherThanDefaulted() throws Exception {
        create();
        clearInvocations(gateway);
        var body = OBSERVATION_JSON.replace("\"valid\": true,", "");
        mvc.perform(
                        post("/v1/sessions/" + id + "/observations")
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(gateway);
    }

    @Test
    void upstreamUnavailableReturnsErrorWhileSavedStateRemainsReadable() throws Exception {
        create();
        when(gateway.end(eq(id), any())).thenThrow(new ContractError(502, "CEP unavailable"));
        mvc.perform(
                        post("/v1/sessions/" + id + "/end")
                                .contentType("application/json")
                                .content("{\"end_ms\":0}"))
                .andExpect(status().isBadGateway());
        mvc.perform(get("/v1/sessions/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ended").value(false));
    }

    @Test
    void scalarCoercionFractionalTimeAndNonfiniteScoresAreRejected() throws Exception {
        create();
        clearInvocations(gateway);
        for (var invalid :
                List.of(
                        OBSERVATION_JSON.replace("\"sequence\": 0", "\"sequence\": 0.5"),
                        OBSERVATION_JSON.replace("\"valid\": true", "\"valid\": \"true\""),
                        OBSERVATION_JSON.replace(
                                "\"collapse_probability\": 0.9",
                                "\"collapse_probability\": \"0.9\""),
                        OBSERVATION_JSON.replace(
                                "\"collapse_probability\": 0.9",
                                "\"collapse_probability\": \"NaN\""))) {
            mvc.perform(
                            post("/v1/sessions/" + id + "/observations")
                                    .contentType("application/json")
                                    .content(invalid))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(gateway);
    }
}
