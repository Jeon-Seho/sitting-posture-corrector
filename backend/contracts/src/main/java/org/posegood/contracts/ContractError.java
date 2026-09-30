package org.posegood.contracts;
public class ContractError extends RuntimeException {
    private final int status;
    public ContractError(int status, String message) { super(message); this.status = status; }
    public int status() { return status; }
}
