import sys
import unittest
from importlib.util import find_spec
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType
from unittest.mock import patch

from scripts.build_sync_embedded_assets import MODULE_NAME, render_asset_module, verify_embedded_assets
from scripts.label_templates import NATIVE_LABEL_TEMPLATE_GEEHY, build_native_label, common
from scripts.sync_assets import read_sync_asset


SCRIPTS = Path(__file__).resolve().parent


class EmbeddedSyncAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module_source = render_asset_module(SCRIPTS / 'assets', SCRIPTS / 'icon.ico')

    def test_packaged_images_render_when_extraction_folder_has_no_artwork(self):
        module = ModuleType(MODULE_NAME)
        exec(self.module_source, vars(module))
        record = {'model': 'APM32F103', 'batch': 'LOT-1', 'quantity': '960', 'production_date': '2642',
                  'package': 'LQFP64', 'trace_no': 'TRACE-01', 'source_no': 'BOX-01'}
        with patch.object(common, '_IMAGE_CACHE', {}):
            expected = build_native_label(record, NATIVE_LABEL_TEMPLATE_GEEHY)
        source_artwork = {name: read_sync_asset(name) for name in module.ASSETS}

        with TemporaryDirectory() as extraction, \
                patch.object(sys, 'frozen', True, create=True), \
                patch.object(sys, '_MEIPASS', extraction, create=True), \
                patch.dict(sys.modules, {MODULE_NAME: module}), \
                patch.object(common, '_IMAGE_CACHE', {}), \
                patch.object(Path, 'read_bytes', side_effect=AssertionError('frozen artwork read a file')):
            self.assertEqual({name: read_sync_asset(name) for name in module.ASSETS}, source_artwork)
            self.assertEqual(build_native_label(record, NATIVE_LABEL_TEMPLATE_GEEHY), expected)
            with self.assertRaises(FileNotFoundError):
                read_sync_asset('assets/missing.png')
            self.assertEqual(list(Path(extraction).iterdir()), [])

    @unittest.skipIf(find_spec('PyInstaller') is None, 'PyInstaller is required for archive verification')
    def test_build_verifier_checks_real_pyz_contents_and_rejects_loose_artwork(self):
        from PyInstaller.archive.writers import CArchiveWriter, ZlibArchiveWriter

        with TemporaryDirectory() as directory:
            root = Path(directory)
            pyz = root / 'PYZ.pyz'
            archive = root / 'test.pkg'
            filename = f'{MODULE_NAME}.py'
            code = compile(self.module_source, filename, 'exec', dont_inherit=True)
            ZlibArchiveWriter(str(pyz), [(MODULE_NAME, filename, 'PYMODULE')], {MODULE_NAME: code})
            package_entries = [('PYZ.pyz', str(pyz), False, 'z')]
            CArchiveWriter(str(archive), package_entries, 'python.dll')
            verify_embedded_assets(archive, self.module_source)
            with self.assertRaisesRegex(ValueError, 'does not match'):
                verify_embedded_assets(archive, self.module_source + '\nASSETS = {}\n')

            loose = ('assets/geehy-logo.png', str(SCRIPTS / 'assets' / 'geehy-logo.png'), True, 'b')
            CArchiveWriter(str(archive), package_entries + [loose], 'python.dll')
            with self.assertRaisesRegex(ValueError, 'loose extraction files'):
                verify_embedded_assets(archive, self.module_source)
