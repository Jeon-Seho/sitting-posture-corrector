package org.posegood.api.web;

import org.posegood.contracts.ContractError;

public class ApiError extends ContractError {
    private final String code;

    public ApiError(int status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
