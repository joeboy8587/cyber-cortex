export function unwrapCorrelationResult<T>(response: unknown): T {
  if (!response || typeof response !== 'object') throw new Error('No correlation result returned');
  const envelope = response as Record<string, unknown>;
  if (envelope.nonFatal || envelope.timedOut || envelope.complete === false || envelope.error) {
    throw new Error(String(envelope.message || envelope.error || 'Correlation analysis did not finish'));
  }
  const result = 'data' in envelope ? envelope.data : response;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Incomplete correlation result');
  const data = result as Record<string, unknown>;
  if (data.error || data.complete === false) throw new Error(String(data.error || 'Correlation analysis did not finish'));
  return result as T;
}