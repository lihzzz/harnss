import type { OperationError, OperationResult } from "@shared/types/productivity";

export class ProductivityError extends Error {
  constructor(readonly code: string, message = code, readonly retryable = false) { super(message); }
}

export function operationError(error: unknown): OperationError {
  return error instanceof ProductivityError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: "IO_ERROR", message: error instanceof Error ? error.message : "Operation failed", retryable: true };
}

export function failure(error: unknown): OperationResult<never> { return { ok: false, error: operationError(error) }; }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isMissingFile(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }
export function assertStorageId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new ProductivityError("INVALID_ARGUMENT", "Invalid project or session ID");
  }
}
