/** Injected side effects so tests can control the network and the clock. */
export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
}

export const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
};
