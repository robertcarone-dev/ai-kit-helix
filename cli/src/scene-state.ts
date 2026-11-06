import { isDeepStrictEqual } from 'node:util';

/** Context gates geometry; outcomes remain diagnostic and must never be normalized to pass. */
export function compareSceneState(reference: any, candidate: any, contract?: any) {
  if (contract === undefined)
    return {
      mode: 'strict',
      context: [],
      outcomes: [],
      observations: [],
      prerequisites:
        reference == null || candidate == null || !isDeepStrictEqual(reference, candidate)
          ? ['state-mismatch-or-missing']
          : [],
    };
  if (
    !contract ||
    typeof contract !== 'object' ||
    Array.isArray(contract) ||
    Object.keys(contract).some(
      (k) => !['contextKeys', 'outcomeKeys', 'observationalKeys'].includes(k),
    )
  )
    throw new Error('Invalid scene stateContract');
  const all = new Set<string>();
  for (const key of ['contextKeys', 'outcomeKeys', 'observationalKeys']) {
    const values = contract[key] ?? [];
    if (!Array.isArray(values) || (key === 'contextKeys' && !values.length))
      throw new Error(
        'stateContract needs nonempty contextKeys and optional outcomeKeys/observationalKeys arrays',
      );
    for (const value of values) {
      if (typeof value !== 'string' || !value || all.has(value))
        throw new Error('State contract keys must be nonempty, unique top-level property names');
      all.add(value);
    }
  }
  const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const row = (key: string) => {
    const a = object(reference) && Object.hasOwn(reference, key);
    const b = object(candidate) && Object.hasOwn(candidate, key);
    return {
      key,
      referencePresent: a,
      candidatePresent: b,
      reference: a ? reference[key] : null,
      candidate: b ? candidate[key] : null,
      status:
        !a || !b
          ? 'unmeasured'
          : isDeepStrictEqual(reference[key], candidate[key])
            ? 'same'
            : 'different',
    };
  };
  const context = contract.contextKeys.map(row);
  const outcomes = (contract.outcomeKeys ?? []).map(row);
  const observations = (contract.observationalKeys ?? []).map((key) => ({
    ...row(key),
    status: 'observed-only',
  }));
  // New adapter fields remain visible and cannot silently disappear from acceptance.
  const unclassified = [
    ...new Set([
      ...Object.keys(object(reference) ? reference : {}),
      ...Object.keys(object(candidate) ? candidate : {}),
    ]),
  ]
    .filter((key) => !all.has(key))
    .map((key) => ({ ...row(key), status: 'unmeasured', reason: 'unclassified-state-key' }));
  return {
    mode: 'explicit',
    context,
    outcomes: [...outcomes, ...unclassified],
    observations,
    prerequisites: context
      .filter((c) => c.status !== 'same')
      .map((c) => 'state-context-' + c.status + ':' + c.key),
  };
}
