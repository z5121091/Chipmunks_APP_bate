"""Package sync artwork as Python constants that PyInstaller loads from the EXE."""

import argparse
from pathlib import Path


MODULE_NAME = 'embedded_sync_assets'


def render_asset_module(assets_dir: Path, icon: Path) -> str:
    images = sorted(assets_dir.glob('*.png'))
    if not images:
        raise ValueError('No label PNG assets were found.')
    entries = [('icon.ico', icon), *((f'assets/{image.name}', image) for image in images)]
    lines = ['# Generated from the synchronization helper artwork.', 'ASSETS = {']
    for name, path in entries:
        data = path.read_bytes()
        if not data:
            raise ValueError(f'Empty sync artwork: {name}')
        lines.append(f'    {name!r}: {data!r},')
    lines.append('}\n')
    return '\n'.join(lines)


def verify_embedded_assets(executable: Path, expected_source: str) -> None:
    # Inspect the completed archive without starting the EXE or extracting files.
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(str(executable))
    names = {name.replace('\\', '/') for name in archive.toc}
    if 'icon.ico' in names or any(name.startswith('assets/') and name.endswith('.png') for name in names):
        raise ValueError('Sync artwork still appears as loose extraction files in the EXE.')
    module_archive = archive.open_embedded_archive('PYZ.pyz')
    if MODULE_NAME not in module_archive.toc:
        raise ValueError('The generated sync artwork module is missing from the EXE.')
    packaged = module_archive.extract(MODULE_NAME)

    expected = compile(expected_source, f'{MODULE_NAME}.py', 'exec', dont_inherit=True)
    # Verify the literals and the code that exposes them without executing archive contents.
    if packaged is None or (packaged.co_code, packaged.co_consts, packaged.co_names) != (
        expected.co_code, expected.co_consts, expected.co_names,
    ):
        raise ValueError('Embedded sync artwork does not match the current source images.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--icon', type=Path, required=True)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--output', type=Path)
    target.add_argument('--verify-exe', type=Path)
    args = parser.parse_args()

    source = render_asset_module(args.assets, args.icon)
    if args.output:
        args.output.write_text(source, encoding='utf-8')
    else:
        verify_embedded_assets(args.verify_exe, source)
        print('Embedded sync label and window artwork verified.')


if __name__ == '__main__':
    main()
