"""Pairing settings: temporary config files and real, withdrawn Tk widgets."""

import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import sync_pairing_settings as settings


class PairingSettingsTestCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.path = os.path.join(directory.name, 'settings.json')
        environment = patch.dict(os.environ, {}, clear=False)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop(settings.PAIRING_ENV, None)

    def write(self, config):
        with open(self.path, 'w', encoding='utf-8-sig') as output:
            json.dump(config, output, ensure_ascii=False)

    def read_bytes(self):
        with open(self.path, 'rb') as source:
            return source.read()


class PairingSettingsStorageTest(PairingSettingsTestCase):
    def test_missing_file_is_off_and_not_created(self):
        result = settings.read_pairing_settings(self.path)
        self.assertEqual(result.key, '')
        self.assertFalse(result.managed_by_environment)
        self.assertFalse(os.path.exists(self.path))

    def test_legacy_key_and_bom_are_loaded(self):
        self.write({'pairingKey': ' old-key ', 'other': {'keep': True}})
        self.assertEqual(settings.read_pairing_settings(self.path).key, 'old-key')

    def test_confirm_preserves_other_settings_and_leaves_no_temporary_files(self):
        self.write({'pairingKey': 'old-key', 'other': {'keep': True}})
        self.assertEqual(settings.save_pairing_settings(self.path, True, ' new-key '), 'new-key')
        with open(self.path, encoding='utf-8') as source:
            self.assertEqual(json.load(source), {'pairingKey': 'new-key', 'other': {'keep': True}})
        self.assertEqual(os.listdir(self.directory), ['settings.json'])

    def test_confirm_off_needs_no_key_and_clears_existing_secret(self):
        self.write({'pairingKey': 'old-secret'})
        settings.save_pairing_settings(self.path, False, '')
        self.assertEqual(settings.read_pairing_settings(self.path).key, '')
        self.assertNotIn(b'old-secret', self.read_bytes())

    def test_off_ignores_invalid_disabled_input(self):
        settings.save_pairing_settings(self.path, False, 'unused 中文')
        self.assertEqual(settings.read_pairing_settings(self.path).key, '')

    def test_invalid_key_does_not_replace_existing_settings(self):
        self.write({'pairingKey': 'old-key'})
        original = self.read_bytes()
        for value in ('', ' ', 'a b', '中', 'a\nb', 'x' * 129, None, 123):
            with self.subTest(value=value), self.assertRaises(ValueError):
                settings.save_pairing_settings(self.path, True, value)
            self.assertEqual(self.read_bytes(), original)
        self.assertEqual(os.listdir(self.directory), ['settings.json'])

    def test_one_and_128_characters_and_symbols_are_valid(self):
        for value in ('x', 'x' * 128, '!@#$%^&*()_+-=[]{};:,.?/~`"\\'):
            with self.subTest(value=value):
                settings.save_pairing_settings(self.path, True, value)
                self.assertEqual(settings.read_pairing_settings(self.path).key, value)

    def test_failed_atomic_replace_keeps_original_bytes_and_removes_temp(self):
        self.write({'pairingKey': 'old-key', 'keep': True})
        original = self.read_bytes()
        with patch.object(settings.os, 'replace', side_effect=PermissionError('blocked')):
            with self.assertRaises(OSError):
                settings.save_pairing_settings(self.path, True, 'new-key')
        self.assertEqual(self.read_bytes(), original)
        self.assertEqual(os.listdir(self.directory), ['settings.json'])

    def test_failed_flush_keeps_original_bytes_and_removes_temp(self):
        self.write({'pairingKey': 'old-key'})
        original = self.read_bytes()
        with patch.object(settings.os, 'fsync', side_effect=OSError('disk error')):
            with self.assertRaises(OSError):
                settings.save_pairing_settings(self.path, False, '')
        self.assertEqual(self.read_bytes(), original)
        self.assertEqual(os.listdir(self.directory), ['settings.json'])

    def test_corrupt_file_cannot_be_overwritten_by_a_default_off_setting(self):
        for content in ('{broken', '[]', '{"pairingKey": 123}'):
            with open(self.path, 'w', encoding='utf-8') as output:
                output.write(content)
            original = self.read_bytes()
            with self.assertRaises(ValueError):
                settings.save_pairing_settings(self.path, False, '')
            self.assertEqual(self.read_bytes(), original)

    def test_environment_override_is_reported_and_file_not_changed(self):
        self.write({'pairingKey': 'file-key'})
        original = self.read_bytes()
        for value in ('environment-key', ''):
            with self.subTest(value=value), patch.dict(os.environ, {settings.PAIRING_ENV: value}):
                result = settings.read_pairing_settings(self.path)
                self.assertTrue(result.managed_by_environment)
                self.assertEqual(result.key, value)
                with self.assertRaises(ValueError):
                    settings.save_pairing_settings(self.path, False, '')
                self.assertEqual(self.read_bytes(), original)


class PairingSettingsWidgetTest(PairingSettingsTestCase):
    """Native widgets run hidden; no real helper, network, printer or config."""

    def setUp(self):
        super().setUp()
        try:
            import tkinter as tk
            self.root = tk.Tk()
        except (ImportError, RuntimeError) as error:
            self.skipTest(f'Tk unavailable: {type(error).__name__}')
        except tk.TclError:
            self.skipTest('Tk display unavailable')
        self.root.withdraw()
        self.addCleanup(self.close_root)
        self.on_saved = Mock()

    def close_root(self):
        try:
            self.root.destroy()
        except Exception:
            pass

    def view(self):
        return settings.PairingSettingsView(self.root, self.path, self.on_saved)

    def test_default_off_disables_entry_and_visibility(self):
        view = self.view()
        self.assertFalse(view.enabled.get())
        self.assertTrue(view.entry.instate(['disabled']))
        self.assertTrue(view.visibility.instate(['disabled']))
        self.assertTrue(view.confirm_button.instate(['!disabled']))
        self.assertFalse(os.path.exists(self.path))

    def test_toggle_on_requires_key_and_stays_open_when_invalid(self):
        view = self.view()
        view.toggle.invoke()
        self.assertTrue(view.enabled.get())
        self.assertTrue(view.entry.instate(['!disabled']))
        view.confirm_button.invoke()
        self.assertIn('请先输入密钥', view.error.get())
        self.assertFalse(os.path.exists(self.path))
        self.assertFalse(view.saved)
        self.assertTrue(self.root.winfo_exists())
        self.on_saved.assert_not_called()
        view.toggle.invoke()
        self.assertEqual(view.error.get(), '')

    def test_valid_confirm_saves_closes_and_notifies_only_enabled_state(self):
        view = self.view()
        view.toggle.invoke()
        view.key.set('new-secret')
        view.confirm_button.invoke()
        self.assertTrue(view.saved)
        self.assertEqual(settings.read_pairing_settings(self.path).key, 'new-secret')
        self.on_saved.assert_called_once_with(True)

    def test_cancel_retains_existing_key_and_other_settings(self):
        self.write({'pairingKey': 'old-key', 'other': True})
        original = self.read_bytes()
        view = self.view()
        view.key.set('changed-key')
        view.toggle.invoke()
        view.cancel_button.invoke()
        self.assertFalse(view.saved)
        self.assertEqual(self.read_bytes(), original)
        self.on_saved.assert_not_called()

    def test_cancel_first_open_creates_no_file(self):
        view = self.view()
        view.toggle.invoke()
        view.key.set('discard-me')
        view.cancel()
        self.assertFalse(os.path.exists(self.path))
        self.on_saved.assert_not_called()

    def test_disable_needs_no_key_and_confirms_false(self):
        self.write({'pairingKey': 'old-key'})
        view = self.view()
        self.assertTrue(view.enabled.get())
        self.assertEqual(view.entry.cget('show'), '●')
        view.toggle.invoke()
        self.assertTrue(view.entry.instate(['disabled']))
        view.confirm_button.invoke()
        self.assertEqual(settings.read_pairing_settings(self.path).key, '')
        self.on_saved.assert_called_once_with(False)

    def test_toggle_off_hides_key_even_if_previously_visible(self):
        self.write({'pairingKey': 'old-key'})
        view = self.view()
        view.visibility.invoke()
        self.assertEqual(view.entry.cget('show'), '')
        view.toggle.invoke()
        self.assertEqual(view.entry.cget('show'), '●')
        view.toggle.invoke()
        self.assertEqual(view.entry.cget('show'), '●')

    def test_save_failure_keeps_window_open_and_old_settings(self):
        self.write({'pairingKey': 'old-key'})
        original = self.read_bytes()
        view = self.view()
        view.key.set('new-key')
        with patch.object(settings.os, 'replace', side_effect=PermissionError('secret must not be displayed')):
            view.confirm_button.invoke()
        self.assertIn('原设置未更改', view.error.get())
        self.assertNotIn('secret', view.error.get())
        self.assertEqual(self.read_bytes(), original)
        self.assertTrue(self.root.winfo_exists())
        self.on_saved.assert_not_called()

    def test_environment_managed_settings_are_read_only_without_echoing_secret(self):
        with patch.dict(os.environ, {settings.PAIRING_ENV: 'environment-secret'}):
            view = self.view()
            self.assertTrue(view.enabled.get())
            self.assertEqual(view.key.get(), '')
            self.assertTrue(view.toggle.instate(['disabled']))
            self.assertTrue(view.confirm_button.instate(['disabled']))
            view.confirm()
        self.assertFalse(os.path.exists(self.path))
        self.on_saved.assert_not_called()

    def test_corrupt_config_stays_read_only_and_unchanged(self):
        self.write({'pairingKey': 123})
        original = self.read_bytes()
        view = self.view()
        self.assertTrue(view.confirm_button.instate(['disabled']))
        self.assertIn('无法读取', view.error.get())
        view.confirm()
        view.cancel()
        self.assertEqual(self.read_bytes(), original)
        self.on_saved.assert_not_called()

    def test_close_and_escape_are_bound_to_cancel(self):
        view = self.view()
        self.assertTrue(self.root.bind('<Escape>'))
        self.assertTrue(self.root.bind('<Return>'))
        self.root.tk.call(self.root.protocol('WM_DELETE_WINDOW'))
        self.assertFalse(view.saved)
        self.assertFalse(os.path.exists(self.path))

    def test_return_on_focused_cancel_does_not_save(self):
        view = self.view()
        view.toggle.invoke()
        view.key.set('discard-me')
        with patch.object(self.root, 'focus_get', return_value=view.cancel_button):
            self.assertEqual(view.handle_return(None), 'break')
        self.assertFalse(os.path.exists(self.path))
        self.on_saved.assert_not_called()

    def test_validation_error_expands_minimum_height_to_keep_buttons_visible(self):
        view = self.view()
        view.toggle.invoke()
        view.confirm()
        self.root.update_idletasks()
        self.assertGreaterEqual(self.root.minsize()[1], self.root.winfo_reqheight())
        self.assertGreaterEqual(self.root.minsize()[0], 520)


class PairingWindowLifecycleTest(unittest.TestCase):
    def test_reopening_focuses_existing_window_instead_of_starting_second_thread(self):
        window = settings.PairingSettingsWindow('unused', Mock(), Mock())
        with patch.object(settings.threading, 'Thread') as thread:
            window.show()
            window.show()
            self.assertEqual(thread.call_count, 1)
            thread.return_value.start.assert_called_once_with()
            self.assertTrue(window._focus.is_set())

    def test_quit_prevents_new_window(self):
        window = settings.PairingSettingsWindow('unused', Mock(), Mock())
        window.close()
        with patch.object(settings.threading, 'Thread') as thread:
            window.show()
            thread.assert_not_called()


if __name__ == '__main__':
    unittest.main()
