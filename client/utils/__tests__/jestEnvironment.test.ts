describe('Expo globals in the Jest environment', () => {
  test('fetch is resolved before Jest tears down its native module mocks', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    expect(descriptor?.get).toBeUndefined();
    expect(typeof descriptor?.value).toBe('function');
  });

  test('clearing module registries does not lazily load native fetch again', () => {
    const fetchBeforeReset = globalThis.fetch;
    const warn = jest.spyOn(console, 'warn');

    try {
      jest.resetModules();
      // Mirror the global lookup used by Jest 29's resetModules/teardown.
      const resolvedGlobals = Object.keys(globalThis).map(key => (
        (globalThis as unknown as Record<string, unknown>)[key]
      ));

      expect(resolvedGlobals).toContain(fetchBeforeReset);
      expect(globalThis.fetch).toBe(fetchBeforeReset);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
