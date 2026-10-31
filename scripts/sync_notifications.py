"""Best-effort desktop business notifications, kept outside request processing.

The dispatcher owns no persistent state and does not start work on import.
Only the worker invokes the supplied desktop-notification callback.
"""

from collections import OrderedDict
from dataclasses import dataclass, field
import re
import threading
import time


_CATEGORY_OUTCOMES = {
    'inbound': frozenset(('success', 'failure', 'unknown')),
    'outbound': frozenset(('success', 'failure', 'unknown')),
    'inventory': frozenset(('success', 'failure')),
    'order_labels': frozenset(('success', 'failure')),
    'unpack': frozenset(('submitted', 'skipped', 'failure', 'unknown')),
    'reprint': frozenset(('submitted', 'failure', 'unknown')),
}
_FILE_TITLES = {
    'inbound': '入库记录',
    'outbound': '出库记录',
    'inventory': '盘点单',
    'order_labels': '订单标签',
}
_REASONS = {
    'file_access': '文件无法访问或正在被占用，请关闭相关文件后重试。',
    'disk_full': '磁盘空间不足，请清理空间后重试。',
    'invalid_content': '数据或标签内容不符合要求，请核对后重试。',
    'printer_error': '打印机或打印队列异常，请检查打印机后重试。',
    'service_error': '同步服务处理失败，请检查同步助手后重试。',
}
_MAX_TOTAL = 999999999


def _count(value):
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return min(max(value, 0), _MAX_TOTAL)


def _file_name(value):
    if not isinstance(value, str):
        return ''
    name = re.split(r'[/\\]', value)[-1]
    name = ''.join(char for char in name if char.isprintable()).strip()
    return name[:64]


@dataclass
class _Pending:
    category: str
    outcome: str
    reason: str
    due: float
    jobs: int = 0
    count: int = 0
    label_count: int = 0
    file_names: list = field(default_factory=list)

    def merge(self, count, label_count, file_name):
        self.jobs = min(self.jobs + 1, _MAX_TOTAL)
        self.count = min(self.count + count, _MAX_TOTAL)
        self.label_count = min(self.label_count + label_count, _MAX_TOTAL)
        if file_name and file_name not in self.file_names and len(self.file_names) < 3:
            self.file_names.append(file_name)


@dataclass
class _Run:
    sender: object
    ephemeral_sender: object = None
    pending: OrderedDict = field(default_factory=OrderedDict)
    failures: dict = field(default_factory=dict)
    stopped: bool = False


def _render(item):
    file_title = _FILE_TITLES.get(item.category, '')
    print_title = '补打标签' if item.category == 'reprint' else '拆包标签'
    if item.outcome == 'success':
        message = (f'已保存 {item.count} 条记录。' if item.jobs == 1 else
                   f'已完成 {item.jobs} 次同步，共保存 {item.count} 条记录。')
        if item.file_names:
            message += '文件：' + '、'.join(item.file_names)
            if item.jobs > len(item.file_names):
                message += '等'
        return file_title + '同步完成', message
    if item.outcome == 'submitted':
        prefix = f'已完成 {item.jobs} 次任务，' if item.jobs > 1 else ''
        skipped = (f'另有 {item.count} 条标签无可用模板，未打印。'
                   if item.category == 'unpack' and item.count else '')
        return print_title + '已提交打印', (
            prefix + f'已提交 {item.label_count} 张标签至打印队列，请核对实际出纸。' + skipped
        )
    if item.outcome == 'skipped':
        prefix = (f'共 {item.count} 条标签未打印。' if item.count else
                  f'共 {item.jobs} 次任务未打印。' if item.jobs > 1 else '')
        return '拆包标签已保存，本次未打印', (
            prefix + '该供应商未配置标签模板，请核对供应商和模板。'
        )
    if item.outcome == 'unknown':
        title = (print_title + '出纸结果待核对' if item.category in ('unpack', 'reprint') else
                 file_title + '同步结果待核对')
        message = ('打印结果暂时无法确认，请检查打印机和实际出纸，再决定是否重试。'
                   if item.category in ('unpack', 'reprint') else
                   '同步结果暂时无法确认，请检查已保存的文件后再决定是否重试。')
        return title, message
    title = (print_title + '打印失败' if item.category in ('unpack', 'reprint') else
             file_title + '同步失败')
    return title, _REASONS[item.reason]


class BusinessNotificationDispatcher:
    """Bounded, thread-safe notification delivery with brief success batching.

    ``publish``, ``start`` and ``stop`` never wait for a desktop notification.
    ``stop`` discards queued work; a callback already committed by the worker
    can finish, but that worker cannot deliver more work after stop or restart.
    An operating-system call already in flight cannot safely be cancelled.
    Delivery failures are deliberately independent of the business operation.

    Reprint delivery requires an explicit ``ephemeral_sender`` that performs
    no logging or storage. Reprints never fall back to the regular sender.
    """

    def __init__(self, *, merge_window_seconds=1.5,
                 failure_cooldown_seconds=30.0, max_pending=100,
                 clock=time.monotonic):
        self._merge_window = max(0.0, float(merge_window_seconds))
        self._failure_cooldown = max(0.0, float(failure_cooldown_seconds))
        self._max_pending = max(1, int(max_pending))
        self._clock = clock
        self._condition = threading.Condition()
        self._run = None

    def start(self, sender, *, ephemeral_sender=None):
        try:
            if not callable(sender):
                return
            with self._condition:
                self._stop_locked()
                # Reprint has no persistent history. Its callback must not use
                # the normal tray sender, which also writes notification logs.
                run = _Run(sender, ephemeral_sender if callable(ephemeral_sender) else None)
                self._run = run
                thread = threading.Thread(
                    target=self._work, args=(run,),
                    name='sync-business-notifications', daemon=True,
                )
                try:
                    thread.start()
                except Exception:
                    self._stop_locked()
        except Exception:
            return

    def _stop_locked(self):
        if self._run is not None:
            self._run.stopped = True
            self._run.pending.clear()
            self._run.failures.clear()
            self._run = None
        self._condition.notify_all()

    def stop(self):
        try:
            with self._condition:
                self._stop_locked()
        except Exception:
            return

    def publish(self, category, outcome, *, count=0, file_name='',
                label_count=0, reason=''):
        try:
            if outcome not in _CATEGORY_OUTCOMES.get(category, ()):
                return
            safe_reason = reason if reason in _REASONS else 'service_error'
            failed = outcome in ('failure', 'unknown')
            # Failure throttling ignores filenames and uncontrolled error text.
            key = (category, outcome, safe_reason if failed else '')
            with self._condition:
                run = self._run
                if run is None or run.stopped:
                    return
                if category == 'reprint' and run.ephemeral_sender is None:
                    return
                now = self._clock()
                if failed:
                    # A later error must not be followed by an older delayed
                    # success/queue/no-template notification from this category.
                    for pending_key, pending in list(run.pending.items()):
                        if (pending.category == category and
                                pending.outcome not in ('failure', 'unknown')):
                            del run.pending[pending_key]
                    last = run.failures.get(key)
                    if last is not None and now - last < self._failure_cooldown:
                        return
                elif outcome in ('success', 'submitted'):
                    # Confirmed recovery starts a new failure episode. A skipped
                    # or still-unknown result is not confirmation of recovery.
                    for failure_key in list(run.failures):
                        if failure_key[0] == category:
                            del run.failures[failure_key]
                item = run.pending.get(key)
                if item is None:
                    if len(run.pending) >= self._max_pending:
                        # Keep a failure visible when a burst fills the queue.
                        if not failed:
                            return
                        success_key = next((pending_key for pending_key, pending
                                            in run.pending.items()
                                            if pending.outcome not in ('failure', 'unknown')), None)
                        if success_key is None:
                            return
                        del run.pending[success_key]
                    item = _Pending(category, outcome, safe_reason,
                                    now if failed else now + self._merge_window)
                    run.pending[key] = item
                # Never retain filenames or label identifiers for reprints,
                # even if an accidental caller supplies one.
                safe_file_name = '' if category == 'reprint' else _file_name(file_name)
                item.merge(_count(count), _count(label_count), safe_file_name)
                if failed:
                    run.failures[key] = now
                self._condition.notify_all()
        except Exception:
            return

    def _work(self, run):
        while True:
            with self._condition:
                while self._run is run and not run.stopped:
                    if run.pending:
                        key, item = min(run.pending.items(), key=lambda pair: pair[1].due)
                        delay = item.due - self._clock()
                        if delay <= 0:
                            del run.pending[key]
                            self._condition.notify_all()
                            break
                        self._condition.wait(timeout=min(delay, 60.0))
                    else:
                        self._condition.wait()
                else:
                    return
            with self._condition:
                if self._run is not run or run.stopped:
                    continue
                # Commit this one delivery while the run is still current.
                # No lifecycle lock is held across the external system call.
                sender = run.ephemeral_sender if item.category == 'reprint' else run.sender
            try:
                if sender is None:
                    continue
                title, message = _render(item)
                sender(title, message)
            except Exception:
                # A platform notification failure must not kill the worker.
                pass
