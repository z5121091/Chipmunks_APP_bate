import json
import os
import tempfile
import tkinter as tk
import unittest
from unittest.mock import Mock, patch

from scripts.sync_connection_qr import ConnectionQrView, build_connection_code, make_connection_image, popup_position, QR_IMAGE_SIZE, QR_WINDOW_WIDTH, QR_WINDOW_HEIGHT
from scripts.sync_pairing_settings import PAIRING_ENV, save_pairing_settings


class ConnectionQrTests(unittest.TestCase):
    def test_matches_app_wire_format_and_preserves_symbols(self):
        key = 'test"\\;=+'
        code = build_connection_code('192.168.1.8', 8080, key)
        self.assertEqual(json.loads(code), {'type': 'palm-warehouse-sync', 'v': 1, 'ip': '192.168.1.8', 'port': 8080, 'key': key})
        self.assertNotIn('key', json.loads(build_connection_code('192.168.1.8', 8080)))
        self.assertNotIn('\n', code)

    def test_invalid_connection_never_generates_a_code(self):
        for address in ('127.0.0.1', '0.0.0.0', '999.1.1.1', '192.168.1.8/path'):
            with self.subTest(address=address), self.assertRaises(ValueError):
                build_connection_code(address, 8080)
        for port in (0, 65536, True, '8080'):
            with self.subTest(port=port), self.assertRaises(ValueError):
                build_connection_code('192.168.1.8', port)

    def test_image_is_square_pure_black_and_white_with_quiet_border(self):
        for key in ('', 'short-key', 'x' * 128, '"\\' * 64):
            with self.subTest(length=len(key)):
                image = make_connection_image(build_connection_code('192.168.1.8', 8080, key))
                self.assertEqual(image.size, (QR_IMAGE_SIZE, QR_IMAGE_SIZE))
                self.assertEqual({color for _count, color in image.getcolors(3)}, {(0, 0, 0), (255, 255, 255)})
                self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_popup_stays_on_the_selected_monitor(self):
        for bounds, anchor in [((0, 0, 1920, 1040), (1910, 1030)), ((-1920, 0, 0, 1040), (-1910, 10))]:
            x, y = popup_position(350, 460, anchor, bounds)
            self.assertGreaterEqual(x, bounds[0]); self.assertGreaterEqual(y, bounds[1])
            self.assertLessEqual(x + 350, bounds[2]); self.assertLessEqual(y + 460, bounds[3])

    def test_window_updates_for_saved_key_network_and_disabling_without_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=False):
            os.environ.pop(PAIRING_ENV, None)
            path = os.path.join(directory, 'config.json')
            root = tk.Tk(); root.withdraw()
            try:
                address = Mock(return_value='192.168.1.8')
                view = ConnectionQrView(root, path, address, 8080)
                root.update_idletasks()
                geometry = root.geometry().split('+')[0]
                self.assertEqual(geometry, f'{QR_WINDOW_WIDTH}x{QR_WINDOW_HEIGHT}')
                self.assertEqual(root.minsize(), root.maxsize())
                self.assertLessEqual(view.status.master.winfo_reqheight(), QR_WINDOW_HEIGHT)
                self.assertLessEqual(view.status.master.winfo_reqwidth(), QR_WINDOW_WIDTH)
                self.assertEqual((view.photo.width(), view.photo.height()), (QR_IMAGE_SIZE, QR_IMAGE_SIZE))
                self.assertFalse(os.path.exists(path))
                self.assertFalse(view.refresh())
                save_pairing_settings(path, True, 'new-key')
                self.assertTrue(view.refresh())
                self.assertEqual(json.loads(view._code)['key'], 'new-key')
                save_pairing_settings(path, True, '"\\' * 64)
                self.assertTrue(view.refresh())
                root.update_idletasks()
                self.assertEqual(root.geometry().split('+')[0], geometry)
                self.assertEqual((view.photo.width(), view.photo.height()), (QR_IMAGE_SIZE, QR_IMAGE_SIZE))
                address.return_value = '192.168.1.9'
                self.assertTrue(view.refresh())
                self.assertEqual(json.loads(view._code)['ip'], '192.168.1.9')
                save_pairing_settings(path, False, '')
                self.assertTrue(view.refresh())
                self.assertNotIn('key', json.loads(view._code))
                with open(path + '.bad', 'w') as output: output.write('{bad')
                os.replace(path + '.bad', path)
                view.refresh()
                self.assertIsNone(view._code)
                self.assertEqual(view.image.cget('image'), '')
                save_path = path + '.new'
                with open(save_path, 'w') as output: output.write('{}')
                os.replace(save_path, path)
                self.assertTrue(view.refresh())
                root.update_idletasks()
                self.assertEqual(root.geometry().split('+')[0], geometry)
                view.photo = None
            finally:
                root.destroy()


if __name__ == '__main__':
    unittest.main()
