// These OS services cannot run inside Node. Native SQLite tests supply a real
// node:sqlite adapter; accidental native I/O in other unit tests must fail.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => { throw new Error('Provide a SQLite adapter in native database tests'); }),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => { throw new Error('Provide a document selection fixture in picker tests'); }),
}));

// Expo 57 installs fetch as a lazy global getter. Jest 29 clears its module/mock
// registries before enumerating globals during teardown; leaving this getter
// unresolved makes that enumeration reload Expo's native logger after tests end.
// Resolve only the function while the preset's native mocks are still alive.
// This does not issue a request; network tests continue supplying their fixtures.
void globalThis.fetch;
