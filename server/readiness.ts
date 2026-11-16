export async function checkReadiness(
  dependencyCheck: () => Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      dependencyCheck().then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
