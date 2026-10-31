import assert from 'node:assert/strict';
import * as files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createAtomicFileWriter } from '../atomicFile.ts';

const fixture = async (t: TestContext) => {
  const directory = await files.mkdtemp(path.join(tmpdir(), 'warehouse-atomic-upload-'));
  t.after(() => files.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'export.xlsx');
  await files.writeFile(target, 'existing-valid-file');
  return { target, directory };
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('complete upload replaces the old file and leaves no temporary files', async t => {
  const { target, directory } = await fixture(t);
  await createAtomicFileWriter()(target, Buffer.from('new-complete-file'));
  assert.equal(await files.readFile(target, 'utf8'), 'new-complete-file');
  assert.deepEqual(await files.readdir(directory), ['export.xlsx']);
});

test('partial write failure preserves the previous file and removes only its own temporary file', async t => {
  const { target, directory } = await fixture(t);
  const writer = createAtomicFileWriter({ ...files, open: async (...args: Parameters<typeof files.open>) => {
    const handle = await files.open(...args);
    handle.writeFile = async () => { await handle.write('partial'); throw new Error('simulated-disk-full'); };
    return handle;
  } });
  await assert.rejects(writer(target, Buffer.from('new-file')), /simulated-disk-full/);
  assert.equal(await files.readFile(target, 'utf8'), 'existing-valid-file');
  assert.deepEqual(await files.readdir(directory), ['export.xlsx']);
});

test('replace failure preserves the old file instead of deleting it as a fallback', async t => {
  const { target, directory } = await fixture(t);
  const writer = createAtomicFileWriter({ ...files, rename: async () => { throw new Error('simulated-file-in-use'); } });
  await assert.rejects(writer(target, Buffer.from('new-file')), /simulated-file-in-use/);
  assert.equal(await files.readFile(target, 'utf8'), 'existing-valid-file');
  assert.deepEqual(await files.readdir(directory), ['export.xlsx']);
});

test('concurrent same-name uploads commit in arrival order and readers keep seeing complete data', async t => {
  const { target, directory } = await fixture(t);
  const firstCommit = deferred();
  const allowCommit = deferred();
  let commits = 0;
  const writer = createAtomicFileWriter({ ...files, rename: async (from, to) => {
    commits++;
    if (commits === 1) { firstCommit.resolve(); await allowCommit.promise; }
    await files.rename(from, to);
  } });
  const first = writer(target, Buffer.from('first-complete-file'));
  await firstCommit.promise;
  const second = writer(target, Buffer.from('second-complete-file'));
  assert.equal(await files.readFile(target, 'utf8'), 'existing-valid-file');
  assert.equal(commits, 1);
  assert.equal((await files.readdir(directory)).length, 2);
  allowCommit.resolve();
  await Promise.all([first, second]);
  assert.equal(commits, 2);
  assert.equal(await files.readFile(target, 'utf8'), 'second-complete-file');
  assert.deepEqual(await files.readdir(directory), ['export.xlsx']);
});

test('a failed write does not poison later uploads to the same target', async t => {
  const { target } = await fixture(t);
  let commits = 0;
  const writer = createAtomicFileWriter({ ...files, rename: async (from, to) => {
    if (++commits === 1) throw new Error('first-failed');
    await files.rename(from, to);
  } });
  const first = writer(target, Buffer.from('first'));
  const second = writer(target, Buffer.from('second'));
  await assert.rejects(first, /first-failed/);
  await second;
  assert.equal(await files.readFile(target, 'utf8'), 'second');
});

test('unrelated filenames do not block each other', async t => {
  const { target, directory } = await fixture(t);
  const firstCommit = deferred();
  const allowFirst = deferred();
  const other = path.join(directory, 'other.xlsx');
  const writer = createAtomicFileWriter({ ...files, rename: async (from, to) => {
    if (to === target) { firstCommit.resolve(); await allowFirst.promise; }
    await files.rename(from, to);
  } });
  const first = writer(target, Buffer.from('first'));
  await firstCommit.promise;
  await writer(other, Buffer.from('unrelated'));
  assert.equal(await files.readFile(other, 'utf8'), 'unrelated');
  allowFirst.resolve();
  await first;
});
