import runpy
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from scripts import label_sync_server as server
from scripts.sync_log_window import RuntimeLogBuffer


class RuntimeLogTests(unittest.TestCase):
    def test_keeps_only_recent_bounded_messages_and_supports_incremental_reads(self):
        logs = RuntimeLogBuffer(max_entries=3, max_message_length=32)
        for index in range(1, 6):
            logs.append(f'entry {index}')
        self.assertEqual(logs.read_after(0), (3, 5, ('entry 3', 'entry 4', 'entry 5')))
        self.assertEqual(logs.read_after(4)[2], ('entry 5',))
        self.assertEqual(logs.read_after(5)[2], ())
        logs.append('长' * 500)
        first, latest, entries = logs.read_after(0)
        self.assertEqual((first, latest), (4, 6))
        self.assertLessEqual(len(entries[-1]), 32)

    def test_concurrent_writes_have_consistent_sequence_and_snapshots(self):
        logs = RuntimeLogBuffer(max_entries=160)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda index: logs.append(f'event {index}'), range(160)))
        first, latest, entries = logs.read_after(0)
        self.assertEqual((first, latest), (1, 160))
        self.assertEqual(len(entries), 160)
        self.assertEqual(set(entries), {f'event {index}' for index in range(160)})

    def test_frozen_runtime_does_not_create_a_log_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sys, 'frozen', True, create=True), \
                    patch.object(sys, 'executable', str(Path(directory) / 'SyncHelper.exe')), \
                    patch.object(server.cherrypy.tools, 'cors', server.cherrypy.tools.cors):
                runtime = runpy.run_path(server.__file__, run_name='scripts._runtime_log_fixture')
                runtime['log']('isolated runtime log')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_windowed_runtime_keeps_logs_with_no_stdout(self):
        logs = RuntimeLogBuffer()
        with patch.object(server, 'RUNTIME_LOGS', logs), patch.object(sys, 'stdout', None):
            server.log('窗口模式日志')
        self.assertTrue(logs.read_after(0)[2][0].endswith('窗口模式日志'))

    def test_tray_action_opens_the_internal_window(self):
        tray = object.__new__(server.TrayIcon)
        tray.log_window = Mock()
        tray.open_logs()
        tray.log_window.show.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
