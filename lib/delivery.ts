export type PushResult = "delivered" | "retry" | "failed" | "expired";
export function classifyPushFailure(error: unknown): {
  state: PushResult;
  code: string;
} {
  const status =
    typeof error === "object" && error && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  return {
    state:
      status === 404 || status === 410
        ? "expired"
        : !status || status === 429 || status >= 500
          ? "retry"
          : "failed",
    code: status ? `http_${status}` : "transport_error",
  };
}
