"""Read synchronization helper artwork from its packaged module or source tree."""

import sys
from pathlib import Path


def read_sync_asset(relative_path: str) -> bytes:
    """Return original image bytes without touching the EXE extraction folder."""
    if getattr(sys, 'frozen', False):
        try:
            from embedded_sync_assets import ASSETS
            return ASSETS[relative_path]
        except (ImportError, KeyError) as error:
            raise FileNotFoundError(relative_path) from error
    return (Path(__file__).parent / relative_path).read_bytes()
