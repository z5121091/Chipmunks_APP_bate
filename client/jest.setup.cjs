// These OS services cannot run inside Node. Native SQLite tests supply a real
// node:sqlite adapter; accidental native I/O in other unit tests must fail.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => { throw new Error('Provide a SQLite adapter in native database tests'); }),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => { throw new Error('Provide a document selection fixture in picker tests'); }),
}));
