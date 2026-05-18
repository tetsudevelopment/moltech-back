/**
 * Read the Nth argument of the Cth call to a jest.fn() mock with a known type.
 *
 * Jest types `mock.calls` as `any[][]`, which trips strict ESLint rules
 * (`no-unsafe-member-access`). This helper centralizes the cast so spec
 * files can write typed, explicit assertions without sprinkling `any`
 * suppressions everywhere.
 *
 * The generic is intentionally return-only — callers always know what
 * shape they expect for that arg, and use the helper precisely to assert
 * it. ESLint's "type parameter used once" rule flags this pattern, but
 * it's the right shape for a test-only cast.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getCallArg<T>(mock: jest.Mock, callIdx = 0, argIdx = 0): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[callIdx];
  if (call === undefined) {
    throw new Error(`Mock has no call at index ${String(callIdx)}`);
  }
  return call[argIdx] as T;
}

/**
 * Find the first call to a jest.fn() mock whose Nth argument matches a
 * predicate. Useful for assertions on event emitters where many different
 * events flow through the same mock and you need to single one out.
 *
 * Returns the matching call's argument tuple (as unknown[]), or undefined
 * if no call matched. Callers can index/cast further as needed.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function findCallByArg<TArg>(
  mock: jest.Mock,
  argIdx: number,
  predicate: (arg: TArg) => boolean,
): unknown[] | undefined {
  const calls = mock.mock.calls as unknown[][];
  return calls.find((call) => predicate(call[argIdx] as TArg));
}
