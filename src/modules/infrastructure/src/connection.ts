/** Fixed-host authentication probes. No transcript/model generation or account data is read. */
export type ProviderName = "deepseek" | "supadata";
export type ConnectionResult = {
  success: boolean;
  provider: string;
  code: string;
  status?: number;
};

export function createConnectionTester(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const request = options.fetch || globalThis.fetch;
  return async (
    provider: string,
    apiKey: string,
  ): Promise<ConnectionResult> => {
    if (provider !== "deepseek" && provider !== "supadata")
      return { success: false, provider, code: "UNKNOWN_PROVIDER" };
    const key = String(apiKey || "").trim();
    if (!key) return { success: false, provider, code: "NO_KEY" };
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 15000,
    );
    try {
      const url =
        provider === "deepseek"
          ? "https://api.deepseek.com/models"
          : "https://api.supadata.ai/v1/me";
      const headers: Record<string,string> =
        provider === "deepseek"
          ? { Authorization: `Bearer ${key}` }
          : { "x-api-key": key };
      const response = await request(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      // Discard account/model metadata. The authenticated status is all this probe needs.
      await response.body?.cancel().catch(() => {});
      const code = response.ok
        ? "CONNECTED"
        : response.status === 401 || response.status === 403
          ? "AUTH_FAILED"
          : response.status === 429
            ? "RATE_LIMITED"
            : "HTTP_ERROR";
      return { success: response.ok, provider, code, status: response.status };
    } catch (_) {
      return {
        success: false,
        provider,
        code: controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
