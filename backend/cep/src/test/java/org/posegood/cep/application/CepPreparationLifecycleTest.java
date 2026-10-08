package org.posegood.cep.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.times;

import com.espertech.esper.runtime.client.EPRuntimeProvider;

import org.junit.jupiter.api.Test;
import org.posegood.cep.esper.EsperDecisionRuntime;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

/** The real preparation must finish during eager bean construction, before any user request. */
class CepPreparationLifecycleTest {
    @Test
    void contextRefreshPerformsRealPreparationAndClosesItsTemporaryRuntime() {
        try (var preparation = mockStatic(EsperDecisionRuntime.class, CALLS_REAL_METHODS);
                var context = new AnnotationConfigApplicationContext(CepSessionService.class)) {
            context.getBean(CepSessionService.class);
            preparation.verify(EsperDecisionRuntime::prepare, times(1));
            assertEquals(0, EPRuntimeProvider.getRuntimeURIs().length);
        }
    }
}
