package com.posture.api.posture.store;

import java.util.List;
import java.util.Optional;

/**
 * (D-32) 확정 서비스 DB(V2.6 {@code posture_service})를 조회하는 최소 기능. 검사 로직({@link ServiceSchemaVerifier})을
 * DB 없이 시험할 수 있게 분리했다. 운영 구현은 {@link JdbcServiceDbProbe}.
 */
interface ServiceDbProbe {

    /** 스키마의 테이블 이름 목록. 스키마가 없으면 빈 목록. */
    List<String> tables(String schema);

    /** 테이블의 컬럼 이름 목록. */
    List<String> columns(String schema, String table);

    /** (D-51) 값 4개(threshold·hold·recover·realert, UK-03)가 같은 판정 정책의 ID. V2.3 정책에는 이름이 없다. */
    Optional<Long> policyIdByValues(String schema, DefaultPolicy policy);

    /** 지금 접속한 계정이 이 스키마에 가진 권한(스키마 단위 + 전역). 예: SELECT, INSERT. */
    List<String> privileges(String schema);
}
