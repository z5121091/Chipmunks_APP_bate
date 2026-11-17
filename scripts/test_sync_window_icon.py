"""Desktop icon resources and real hidden sync helper windows; no running service."""

import os
import sys
import tempfile
import tkinter as tk
import unittest
from unittest.mock import Mock, patch

from scripts import sync_window_icon
from scripts.sync_connection_qr import ConnectionQrView
from scripts.sync_log_window import RuntimeLogBuffer, RuntimeLogView
from scripts.sync_pairing_settings import PairingSettingsView


class SyncWindowIconTests(unittest.TestCase):
    def test_applies_icon_bytes_without_a_file_in_the_extraction_directory(self):
        window = Mock()
        data = sync_window_icon.read_sync_asset('icon.ico')
        with tempfile.TemporaryDirectory() as empty_extraction, \
                patch.object(sys, '_MEIPASS', empty_extraction, create=True), \
                patch.object(sync_window_icon, 'read_sync_asset', return_value=data) as read_asset, \
                patch('PIL.ImageTk.PhotoImage', side_effect=lambda image, **kwargs: Mock()) as photo_image:
            self.assertTrue(sync_window_icon.apply_sync_window_icon(window))
            self.assertEqual(os.listdir(empty_extraction), [])
        read_asset.assert_called_once_with('icon.ico')
        photos = photo_image.call_args_list
        self.assertEqual([call.args[0].size for call in photos],
                         [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        self.assertTrue(all(call.kwargs['master'] is window for call in photos))
        default, current = window.iconphoto.call_args_list
        self.assertIs(default.args[0], True)
        self.assertIs(current.args[0], False)
        self.assertEqual(len(default.args), len(photos) + 1)
        self.assertEqual(default.args[1:], current.args[1:])

    def test_decorative_icon_failure_does_not_block_window(self):
        with patch.object(sync_window_icon, 'read_sync_asset', side_effect=FileNotFoundError('asset unavailable')):
            self.assertFalse(sync_window_icon.apply_sync_window_icon(Mock()))
        with patch.object(sync_window_icon, 'read_sync_asset', return_value=b'invalid icon'):
            self.assertFalse(sync_window_icon.apply_sync_window_icon(Mock()))
        window = Mock(iconphoto=Mock(side_effect=tk.TclError('icon unavailable')))
        with patch('PIL.ImageTk.PhotoImage'):
            self.assertFalse(sync_window_icon.apply_sync_window_icon(window))

    def test_all_helper_views_use_default_application_icon_without_caller_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            config = os.path.join(directory, 'pairing.json')
            constructors = [
                ('scripts.sync_pairing_settings', lambda root: PairingSettingsView(root, config, Mock())),
                ('scripts.sync_connection_qr', lambda root: ConnectionQrView(root, config, lambda: '192.168.1.9', 8080)),
                ('scripts.sync_log_window', lambda root: RuntimeLogView(root, RuntimeLogBuffer())),
            ]
            for module, constructor in constructors:
                with self.subTest(module=module):
                    root = tk.Tk()
                    root.withdraw()
                    try:
                        with patch(module + '.apply_sync_window_icon', wraps=sync_window_icon.apply_sync_window_icon) as apply, \
                                patch.object(root, 'iconphoto', wraps=root.iconphoto) as assign_icon:
                            view = constructor(root)
                            root.update_idletasks()
                            apply.assert_called_once()
                            self.assertIs(apply.call_args.args[0], root)
                            self.assertEqual([call.args[0] for call in assign_icon.call_args_list], [True, False])
                            self.assertTrue(root.winfo_exists())
                            if hasattr(view, 'photo'):
                                view.photo = None
                    finally:
                        root.destroy()
            self.assertFalse(os.path.exists(config))

    @unittest.skipUnless(sys.platform == 'win32', 'Windows native title-bar icon check')
    def test_native_window_has_an_explicit_application_icon(self):
        import ctypes
        from ctypes import wintypes

        user = ctypes.windll.user32
        user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user.SendMessageW.restype = wintypes.HANDLE
        root = tk.Tk()
        root.withdraw()
        try:
            root.update_idletasks()
            before_icon = user.SendMessageW(int(root.wm_frame(), 0), 0x007F, 0, 0)
            self.assertTrue(sync_window_icon.apply_sync_window_icon(root))
            root.update_idletasks()
            # WM_GETICON/ICON_SMALL: read the actual native title-bar icon,
            # and prove the photo snapshot is still installed after returning.
            current_icon = user.SendMessageW(int(root.wm_frame(), 0), 0x007F, 0, 0)
            self.assertTrue(current_icon)
            self.assertNotEqual(current_icon, before_icon)
        finally:
            root.destroy()


if __name__ == '__main__':
    unittest.main()
