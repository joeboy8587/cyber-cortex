export async function withAnalysisDeadline<T>(work: PromiseLike<T>, milliseconds = 35_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Analysis timed out before completion'), { code: 'ANALYSIS_TIMEOUT' })), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}