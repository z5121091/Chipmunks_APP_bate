"""Cross-process publication/retention lock (production runs on Linux)."""
from contextlib import contextmanager


@contextmanager
def storage_lock(root):
    with (root / '.storage.lock').open('a+b') as stream:
        try:
            import fcntl
        except ImportError:
            # Windows is used only for local unit tests, never the production service.
            yield
        else:
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)
