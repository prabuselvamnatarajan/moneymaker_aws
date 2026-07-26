/** Fire N concurrent identical async operations (race-condition tests) */
export async function fireConcurrent<T>(
  fn: () => Promise<T>,
  n: number
): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, () => fn()));
}

export async function fireConcurrentWithResults<T>(
  fn: (index: number) => Promise<T>,
  n: number
): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}
