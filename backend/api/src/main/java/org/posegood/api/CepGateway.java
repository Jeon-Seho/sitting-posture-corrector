package org.posegood.api;
import org.posegood.contracts.*;
import java.util.UUID;
public interface CepGateway {
    SessionView create(UUID id,CreateSession request);
    SessionView observe(UUID id,Observation observation);
    SessionView end(UUID id,EndSession request);
}
