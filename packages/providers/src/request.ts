/** Bound provider API calls so a stalled remote service cannot pin a queue worker indefinitely. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export function providerRequestSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
}
