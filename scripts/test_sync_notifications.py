"""Real-worker checks; all desktop callbacks are in-memory test doubles."""

import threading
import unittest
from unittest.mock import patch

from scripts.sync_notifications import BusinessNotificationDispatcher


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class Deliveries:
    def __init__(self):
        self.items = []
        self.condition = threading.Condition()

    def __call__(self, title, message):
        with self.condition:
            self.items.append((title, message, threading.get_ident()))
            self.condition.notify_all()

    def wait(self, count=1):
        with self.condition:
            if not self.condition.wait_for(lambda: len(self.items) >= count, timeout=2):
                raise AssertionError(f'Expected {count} notifications; received {self.items!r}')


class BusinessNotificationDispatcherTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.deliveries = Deliveries()
        self.ephemeral_deliveries = Deliveries()
        self.dispatcher = BusinessNotificationDispatcher(clock=self.clock)
        self.addCleanup(self.dispatcher.stop)

    def advance(self, seconds=2):
        with self.dispatcher._condition:
            self.clock.now += seconds
            self.dispatcher._condition.notify_all()

    def start(self, sender=None, *, ephemeral_sender=None):
        self.dispatcher.start(sender or self.deliveries, ephemeral_sender=ephemeral_sender)

    def test_constructor_does_not_start_threads(self):
        with patch('scripts.sync_notifications.threading.Thread') as thread:
            BusinessNotificationDispatcher()
        thread.assert_not_called()

    def test_publish_before_start_and_after_stop_is_ignored(self):
        self.dispatcher.publish('inbound', 'success', count=2)
        self.start()
        self.assertFalse(self.dispatcher._run.pending)
        self.dispatcher.stop()
        self.dispatcher.publish('outbound', 'failure', reason='disk_full')
        self.assertIsNone(self.dispatcher._run)
        self.assertEqual(self.deliveries.items, [])

    def test_inbound_successes_merge_without_sliding_deadline(self):
        self.start()
        self.dispatcher.publish('inbound', 'success', count=20, file_name='入库单A.xlsx')
        self.advance(1)
        self.dispatcher.publish('inbound', 'success', count=5, file_name='入库单B.xlsx')
        self.advance(.5)
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][:2], (
            '入库记录同步完成', '已完成 2 次同步，共保存 25 条记录。文件：入库单A.xlsx、入库单B.xlsx',
        ))

    def test_outbound_and_inbound_are_separate(self):
        self.start()
        self.dispatcher.publish('inbound', 'success', count=2)
        self.dispatcher.publish('outbound', 'success', count=3)
        self.advance()
        self.deliveries.wait(2)
        self.assertEqual({item[0] for item in self.deliveries.items},
                         {'入库记录同步完成', '出库记录同步完成'})

    def test_inventory_and_order_labels_render_file_results(self):
        self.start()
        self.dispatcher.publish('inventory', 'success', count=12, file_name='盘点A.xlsx')
        self.dispatcher.publish('order_labels', 'success', count=7, file_name='标签B.xlsx')
        self.advance()
        self.deliveries.wait(2)
        self.assertEqual([item[:2] for item in self.deliveries.items], [
            ('盘点单同步完成', '已保存 12 条记录。文件：盘点A.xlsx'),
            ('订单标签同步完成', '已保存 7 条记录。文件：标签B.xlsx'),
        ])
        self.dispatcher.publish('inventory', 'failure', reason='file_access')
        self.dispatcher.publish('order_labels', 'failure', reason='disk_full')
        self.deliveries.wait(4)
        self.assertEqual([item[0] for item in self.deliveries.items[2:]],
                         ['盘点单同步失败', '订单标签同步失败'])
        self.assertIn('文件无法访问', self.deliveries.items[2][1])
        self.assertIn('磁盘空间不足', self.deliveries.items[3][1])

    def test_new_file_categories_merge_independently(self):
        self.start()
        for category in ('inventory', 'order_labels'):
            self.dispatcher.publish(category, 'success', count=2, file_name='A.xlsx')
            self.dispatcher.publish(category, 'success', count=3, file_name='B.xlsx')
        self.advance()
        self.deliveries.wait(2)
        self.assertEqual({item[0] for item in self.deliveries.items},
                         {'盘点单同步完成', '订单标签同步完成'})
        for _, message, _ in self.deliveries.items:
            self.assertEqual(message, '已完成 2 次同步，共保存 5 条记录。文件：A.xlsx、B.xlsx')

    def test_all_new_categories_failure_cooldowns_and_recovery_are_independent(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        for category in ('inventory', 'order_labels', 'reprint'):
            self.dispatcher.publish(category, 'failure', reason='service_error')
        self.deliveries.wait(2)
        self.ephemeral_deliveries.wait()
        # Recovery in inventory must not reset either of the other categories.
        self.dispatcher.publish('inventory', 'success', count=1)
        for category in ('inventory', 'order_labels', 'reprint'):
            self.dispatcher.publish(category, 'failure', reason='service_error')
        self.deliveries.wait(3)
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.assertEqual([item[0] for item in self.deliveries.items],
                         ['盘点单同步失败', '订单标签同步失败', '盘点单同步失败'])
        self.assertEqual(len(self.ephemeral_deliveries.items), 1)
        # Recovery in each remaining category starts its own new episode.
        self.dispatcher.publish('order_labels', 'success', count=1)
        self.dispatcher.publish('order_labels', 'failure', reason='service_error')
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.dispatcher.publish('reprint', 'failure', reason='service_error')
        self.deliveries.wait(4)
        self.ephemeral_deliveries.wait(2)
        self.assertEqual(self.deliveries.items[-1][0], '订单标签同步失败')
        self.assertEqual(self.ephemeral_deliveries.items[-1][0], '补打标签打印失败')

    def test_new_category_failure_cooldown_expires_after_thirty_seconds(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        categories = ('inventory', 'order_labels', 'reprint')
        for category in categories:
            self.dispatcher.publish(category, 'failure', reason='service_error')
        self.deliveries.wait(2)
        self.ephemeral_deliveries.wait()
        self.advance(29)
        for category in categories:
            self.dispatcher.publish(category, 'failure', reason='service_error')
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.advance(1)
        for category in categories:
            self.dispatcher.publish(category, 'failure', reason='service_error')
        self.deliveries.wait(4)
        self.ephemeral_deliveries.wait(2)

    def test_reprint_only_uses_ephemeral_callback_and_never_retains_label_content(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        with patch('builtins.open') as file_open, patch('logging.Logger._log') as log:
            self.dispatcher.publish('reprint', 'submitted', count=99, label_count=2,
                                    file_name='private-model-trace-id.xlsx', reason='SECRET exception')
            with self.dispatcher._condition:
                pending = next(iter(self.dispatcher._run.pending.values()))
                self.assertFalse(pending.file_names)
                self.assertEqual(pending.reason, 'service_error')
            self.advance()
            self.ephemeral_deliveries.wait()
            file_open.assert_not_called()
            log.assert_not_called()
        self.assertFalse(self.deliveries.items)
        title, message, worker_id = self.ephemeral_deliveries.items[0]
        self.assertEqual(title, '补打标签已提交打印')
        self.assertEqual(message, '已提交 2 张标签至打印队列，请核对实际出纸。')
        self.assertNotIn('private', message)
        self.assertNotIn('SECRET', message)
        self.assertNotIn('无可用模板', message)
        self.assertNotEqual(worker_id, threading.get_ident())

    def test_reprint_without_ephemeral_callback_is_not_queued_or_sent(self):
        for callback in (None, object()):
            with self.subTest(callback=callback):
                self.start(ephemeral_sender=callback)
                for outcome in ('submitted', 'failure', 'unknown'):
                    self.dispatcher.publish('reprint', outcome, label_count=2, reason='printer_error')
                with self.dispatcher._condition:
                    self.assertFalse(self.dispatcher._run.pending)
                    self.assertFalse(self.dispatcher._run.failures)
        self.assertFalse(self.deliveries.items)

    def test_reprint_callback_exception_never_falls_back_to_logging_sender(self):
        attempted = threading.Event()

        def broken_ephemeral(title, message):
            attempted.set()
            raise RuntimeError('OS notification unavailable')

        self.start(ephemeral_sender=broken_ephemeral)
        self.dispatcher.publish('reprint', 'failure', reason='printer_error')
        self.assertTrue(attempted.wait(2))
        self.dispatcher.publish('inventory', 'failure', reason='file_access')
        self.deliveries.wait()
        self.assertEqual([item[0] for item in self.deliveries.items], ['盘点单同步失败'])

    def test_lost_ephemeral_callback_never_falls_back_during_worker_delivery(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        with self.dispatcher._condition:
            self.dispatcher._run.ephemeral_sender = None
        self.advance()
        # This following immediate file event is delivered only after the
        # earlier-due reprint was discarded by the same worker.
        self.dispatcher.publish('inventory', 'failure', reason='file_access')
        self.deliveries.wait()
        self.assertEqual([item[0] for item in self.deliveries.items], ['盘点单同步失败'])
        self.assertFalse(self.ephemeral_deliveries.items)

    def test_restart_discards_reprint_queue_and_does_not_reuse_old_callback(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        old_run = self.dispatcher._run
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.start()
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.assertTrue(old_run.stopped)
        self.assertFalse(old_run.pending)
        with self.dispatcher._condition:
            self.assertIsNone(self.dispatcher._run.ephemeral_sender)
            self.assertFalse(self.dispatcher._run.pending)
        self.assertFalse(self.deliveries.items)
        self.assertFalse(self.ephemeral_deliveries.items)

    def test_reprint_submissions_merge_without_changing_unpack_summary(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.advance(1)
        self.dispatcher.publish('reprint', 'submitted', label_count=4)
        self.dispatcher.publish('unpack', 'submitted', label_count=3, count=1)
        self.advance(.5)
        self.ephemeral_deliveries.wait()
        self.assertEqual(self.ephemeral_deliveries.items[0][:2], (
            '补打标签已提交打印', '已完成 2 次任务，已提交 6 张标签至打印队列，请核对实际出纸。',
        ))
        self.assertFalse(self.deliveries.items)
        self.advance(1)
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][0], '拆包标签已提交打印')
        self.assertIn('另有 1 条标签无可用模板', self.deliveries.items[0][1])

    def test_reprint_unknown_uses_ephemeral_callback_and_discards_pending_submission(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.dispatcher.publish('reprint', 'unknown', reason='printer_error')
        self.ephemeral_deliveries.wait()
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.assertEqual(self.ephemeral_deliveries.items[0][0], '补打标签出纸结果待核对')
        self.assertIn('再决定是否重试', self.ephemeral_deliveries.items[0][1])
        self.assertFalse(self.deliveries.items)

    def test_new_categories_reject_inapplicable_outcomes(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        for category, outcomes in (
                ('reprint', ('success', 'skipped')),
                ('inventory', ('submitted', 'skipped', 'unknown')),
                ('order_labels', ('submitted', 'skipped', 'unknown'))):
            for outcome in outcomes:
                self.dispatcher.publish(category, outcome, label_count=2)
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.assertFalse(self.deliveries.items)
        self.assertFalse(self.ephemeral_deliveries.items)

    def test_stop_discards_reprint_and_file_notifications(self):
        self.start(ephemeral_sender=self.ephemeral_deliveries)
        run = self.dispatcher._run
        self.dispatcher.publish('reprint', 'submitted', label_count=2)
        self.dispatcher.publish('inventory', 'success', count=3)
        self.dispatcher.publish('order_labels', 'success', count=1)
        self.dispatcher.stop()
        self.advance()
        self.assertTrue(run.stopped)
        self.assertFalse(run.pending)
        self.assertFalse(run.failures)
        self.assertFalse(self.deliveries.items)
        self.assertFalse(self.ephemeral_deliveries.items)

    def test_submitted_reports_spool_submission_not_actual_printing(self):
        self.start()
        self.dispatcher.publish('unpack', 'submitted', label_count=2)
        self.dispatcher.publish('unpack', 'submitted', label_count=3)
        self.advance()
        self.deliveries.wait()
        title, message, _ = self.deliveries.items[0]
        self.assertEqual(title, '拆包标签已提交打印')
        self.assertIn('5 张标签至打印队列', message)
        self.assertIn('请核对实际出纸', message)
        self.assertNotIn('打印成功', message)

    def test_skipped_reports_saved_without_printing(self):
        self.start()
        self.dispatcher.publish('unpack', 'skipped')
        self.advance()
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][:2], (
            '拆包标签已保存，本次未打印', '该供应商未配置标签模板，请核对供应商和模板。',
        ))

    def test_partial_template_support_uses_one_combined_notification(self):
        self.start()
        self.dispatcher.publish('unpack', 'submitted', label_count=2, count=1)
        self.dispatcher.publish('unpack', 'submitted', label_count=4, count=2)
        self.advance()
        self.deliveries.wait()
        self.assertEqual(len(self.deliveries.items), 1)
        self.assertIn('6 张标签至打印队列', self.deliveries.items[0][1])
        self.assertIn('另有 3 条标签无可用模板，未打印', self.deliveries.items[0][1])

    def test_skipped_count_is_distinct_from_number_of_uploads(self):
        self.start()
        self.dispatcher.publish('unpack', 'skipped', count=4)
        self.advance()
        self.deliveries.wait()
        self.assertIn('共 4 条标签未打印', self.deliveries.items[0][1])

    def test_identical_failure_throttles_for_thirty_seconds(self):
        self.start()
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait()
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.advance(29)
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.advance(1)
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait(2)
        self.assertEqual(len(self.deliveries.items), 2)

    def test_file_success_then_failure_discards_delayed_success(self):
        self.start()
        self.dispatcher.publish('outbound', 'success', count=20)
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait()
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.advance()
        self.dispatcher.stop()
        self.assertEqual([item[0] for item in self.deliveries.items], ['出库记录同步失败'])

    def test_unknown_discards_pending_submitted_and_skipped_for_same_category(self):
        self.start()
        self.dispatcher.publish('unpack', 'submitted', label_count=4)
        self.dispatcher.publish('unpack', 'skipped', count=1)
        self.dispatcher.publish('inbound', 'success', count=2)
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        self.deliveries.wait()
        with self.dispatcher._condition:
            self.assertEqual({item.category for item in self.dispatcher._run.pending.values()}, {'inbound'})
        self.advance()
        self.deliveries.wait(2)
        self.assertEqual([item[0] for item in self.deliveries.items],
                         ['拆包标签出纸结果待核对', '入库记录同步完成'])

    def test_throttled_failure_also_discards_pending_skipped(self):
        self.start()
        self.dispatcher.publish('unpack', 'failure', reason='printer_error')
        self.deliveries.wait()
        self.dispatcher.publish('unpack', 'skipped', count=1)
        self.dispatcher.publish('unpack', 'failure', reason='printer_error')
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
        self.assertEqual(len(self.deliveries.items), 1)

    def test_success_resets_same_category_failure_episode_within_cooldown(self):
        self.start()
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait()
        self.dispatcher.publish('outbound', 'success', count=3)
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait(2)
        self.assertEqual([item[0] for item in self.deliveries.items],
                         ['出库记录同步失败', '出库记录同步失败'])

    def test_submitted_resets_prior_unknown_failure_episode(self):
        self.start()
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        self.deliveries.wait()
        self.dispatcher.publish('unpack', 'submitted', label_count=2)
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        self.deliveries.wait(2)
        self.assertEqual([item[0] for item in self.deliveries.items],
                         ['拆包标签出纸结果待核对', '拆包标签出纸结果待核对'])

    def test_skipped_does_not_clear_unconfirmed_unknown_cooldown(self):
        self.start()
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        self.deliveries.wait()
        self.dispatcher.publish('unpack', 'skipped', count=1)
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        with self.dispatcher._condition:
            self.assertFalse(self.dispatcher._run.pending)
            self.assertIn(('unpack', 'unknown', 'printer_error'), self.dispatcher._run.failures)
        self.assertEqual(len(self.deliveries.items), 1)

    def test_other_category_success_does_not_clear_failure_cooldown(self):
        self.start()
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.deliveries.wait()
        self.dispatcher.publish('inbound', 'success', count=2)
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        with self.dispatcher._condition:
            self.assertEqual({item.category for item in self.dispatcher._run.pending.values()}, {'inbound'})
        self.assertEqual(len(self.deliveries.items), 1)

    def test_different_failures_and_categories_are_not_throttled(self):
        self.start()
        self.dispatcher.publish('outbound', 'failure', reason='file_access')
        self.dispatcher.publish('outbound', 'failure', reason='disk_full')
        self.dispatcher.publish('inbound', 'failure', reason='file_access')
        self.deliveries.wait(3)
        self.assertEqual(len(self.deliveries.items), 3)

    def test_unknown_result_requires_manual_check(self):
        self.start()
        self.dispatcher.publish('unpack', 'unknown', reason='printer_error')
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][0], '拆包标签出纸结果待核对')
        self.assertIn('再决定是否重试', self.deliveries.items[0][1])

    def test_uncontrolled_reason_is_never_displayed(self):
        self.start()
        self.dispatcher.publish('unpack', 'failure', reason='SECRET trace model / password')
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][1],
                         '同步服务处理失败，请检查同步助手后重试。')
        self.assertNotIn('SECRET', str(self.deliveries.items))

    def test_each_allowed_reason_uses_fixed_message(self):
        self.start()
        for reason in ('file_access', 'disk_full', 'invalid_content', 'printer_error', 'service_error'):
            self.dispatcher.publish('unpack', 'failure', reason=reason)
        self.deliveries.wait(5)
        self.assertEqual(len({item[1] for item in self.deliveries.items}), 5)

    def test_file_name_is_bounded_and_paths_controls_are_removed(self):
        self.start()
        self.dispatcher.publish('inbound', 'success', count=1,
                                file_name='C:\\private\\' + 'a' * 90 + '\n.xlsx')
        self.advance()
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][1], '已保存 1 条记录。文件：' + 'a' * 64)

    def test_file_summary_is_bounded_for_large_batch(self):
        self.start()
        for index in range(1000):
            self.dispatcher.publish('inbound', 'success', count=1, file_name=f'{index}.xlsx')
        with self.dispatcher._condition:
            self.assertEqual(len(next(iter(self.dispatcher._run.pending.values())).file_names), 3)
        self.advance()
        self.deliveries.wait()
        self.assertIn('1000 次同步，共保存 1000 条记录', self.deliveries.items[0][1])
        self.assertIn('0.xlsx、1.xlsx、2.xlsx等', self.deliveries.items[0][1])
        self.assertNotIn('3.xlsx', self.deliveries.items[0][1])

    def test_counts_are_safe_nonnegative_bounded_integers(self):
        self.start()
        for value in (-2, 1.5, True, '20', None, 10 ** 100):
            self.dispatcher.publish('inbound', 'success', count=value)
        self.advance()
        self.deliveries.wait()
        self.assertIn('共保存 999999999 条记录', self.deliveries.items[0][1])

    def test_invalid_inputs_do_not_raise_or_queue(self):
        self.start()
        for category, outcome, reason in (([], 'success', ''), ('inbound', [], ''),
                                         ('inbound', 'failure', []), ('other', 'success', ''),
                                         ('unpack', 'success', ''), ('inbound', 'submitted', '')):
            self.dispatcher.publish(category, outcome, reason=reason)
        self.assertFalse(self.dispatcher._run.pending)

    def test_pending_queue_is_bounded_and_failure_can_replace_success(self):
        self.dispatcher.stop()
        self.dispatcher = BusinessNotificationDispatcher(clock=self.clock, max_pending=1)
        self.addCleanup(self.dispatcher.stop)
        self.start()
        self.dispatcher.publish('inbound', 'success', count=1)
        self.dispatcher.publish('outbound', 'success', count=1)
        with self.dispatcher._condition:
            self.assertEqual(len(self.dispatcher._run.pending), 1)
        self.dispatcher.publish('unpack', 'failure', reason='printer_error')
        self.deliveries.wait()
        self.assertEqual(self.deliveries.items[0][0], '拆包标签打印失败')

    def test_sender_runs_on_worker_thread(self):
        self.start()
        self.dispatcher.publish('inbound', 'failure')
        self.deliveries.wait()
        self.assertNotEqual(self.deliveries.items[0][2], threading.get_ident())

    def test_publish_does_not_wait_for_blocked_sender(self):
        started, release, published = threading.Event(), threading.Event(), threading.Event()

        def sender(title, message):
            started.set()
            release.wait(2)

        self.start(sender)
        self.dispatcher.publish('inbound', 'failure')
        self.assertTrue(started.wait(2))
        publisher = threading.Thread(target=lambda: (
            self.dispatcher.publish('outbound', 'success', count=5), published.set()
        ))
        try:
            publisher.start()
            self.assertTrue(published.wait(1), 'publish waited for desktop notification')
        finally:
            release.set()
            publisher.join(2)

    def test_sender_exception_does_not_kill_worker(self):
        calls = []

        def sender(title, message):
            calls.append(title)
            if len(calls) == 1:
                raise RuntimeError('OS notification unavailable')
            self.deliveries(title, message)

        self.start(sender)
        self.dispatcher.publish('inbound', 'failure')
        self.dispatcher.publish('outbound', 'failure')
        self.deliveries.wait()
        self.assertEqual(len(calls), 2)

    def test_stop_discards_pending_notifications(self):
        self.start()
        run = self.dispatcher._run
        self.dispatcher.publish('inbound', 'success', count=4)
        self.dispatcher.stop()
        self.advance()
        self.assertTrue(run.stopped)
        self.assertFalse(run.pending)
        self.assertEqual(self.deliveries.items, [])

    def test_stop_and_restart_do_not_wait_for_blocked_old_sender(self):
        started, release, completed = threading.Event(), threading.Event(), threading.Event()
        stopped, restarted = threading.Event(), threading.Event()
        old = Deliveries()

        def blocked_sender(title, message):
            started.set()
            release.wait(3)
            old(title, message)
            completed.set()

        self.start(blocked_sender)
        old_run = self.dispatcher._run
        self.dispatcher.publish('inbound', 'failure')
        self.assertTrue(started.wait(2))
        # This second old-generation event must never reach the old sender.
        self.dispatcher.publish('outbound', 'failure')

        def stop_and_restart():
            self.dispatcher.stop()
            stopped.set()
            self.start()
            restarted.set()

        lifecycle = threading.Thread(target=stop_and_restart)
        try:
            lifecycle.start()
            self.assertTrue(stopped.wait(1), 'stop waited for an operating-system callback')
            self.assertTrue(restarted.wait(1), 'start waited for an old operating-system callback')
            self.assertTrue(old_run.stopped)
            self.assertFalse(old_run.pending)
            self.dispatcher.publish('unpack', 'failure')
            self.deliveries.wait()
            self.assertEqual(self.deliveries.items[0][0], '拆包标签打印失败')
        finally:
            release.set()
            lifecycle.join(2)
        self.assertTrue(completed.wait(2))
        self.assertEqual([item[0] for item in old.items], ['入库记录同步失败'])

    def test_thread_start_failure_is_best_effort(self):
        with patch('scripts.sync_notifications.threading.Thread.start', side_effect=RuntimeError('no thread')):
            self.start()
        self.assertIsNone(self.dispatcher._run)
        self.dispatcher.publish('inbound', 'failure')

    def test_callback_can_stop_itself_without_deadlock(self):
        def sender(title, message):
            self.dispatcher.stop()
            self.deliveries(title, message)

        self.start(sender)
        self.dispatcher.publish('inbound', 'failure')
        self.deliveries.wait()
        self.assertIsNone(self.dispatcher._run)


if __name__ == '__main__':
    unittest.main()
