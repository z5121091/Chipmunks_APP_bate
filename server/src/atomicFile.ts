import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

type FileOperations = { mkdir: typeof mkdir; open: typeof open; rename: typeof rename; rm: typeof rm };

/** A failed upload never truncates the existing copy. Same-target writes commit in arrival order. */
export const createAtomicFileWriter = (files: FileOperations = { mkdir, open, rename, rm }) => {
  const pending = new Map<string, Promise<void>>();

  return (filePath: string, contents: Buffer): Promise<void> => {
    const resolvedPath = path.resolve(filePath);
    const key = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
    const previous = pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      await files.mkdir(path.dirname(resolvedPath), { recursive: true });
      const temporaryPath = path.join(path.dirname(resolvedPath), `.${path.basename(resolvedPath)}.${randomUUID()}.upload.tmp`);
      try {
        const handle = await files.open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(contents);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Same-directory rename replaces the complete file atomically. Never delete the old file first.
        await files.rename(temporaryPath, resolvedPath);
      } finally {
        await files.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
    pending.set(key, task);
    const release = () => { if (pending.get(key) === task) pending.delete(key); };
    void task.then(release, release);
    return task;
  };
};

export const writeFileAtomically = createAtomicFileWriter();
