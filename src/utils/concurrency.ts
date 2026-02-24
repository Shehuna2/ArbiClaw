export const runLimited = async <T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      out[current] = await task(items[current], current);
    }
  };

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
};
