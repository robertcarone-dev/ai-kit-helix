// Browser evaluations must be serializable before entering an evidence receipt.
export function receiptValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw new Error('Browser script returned a non-JSON value. Return plain evidence data instead of a scene or runtime object; setup may already have executed. Reset before retrying.', { cause });
  }
}
