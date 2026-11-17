"""Use the same in-memory icon for every sync helper desktop window."""

from io import BytesIO

if __package__:
    from .sync_assets import read_sync_asset
else:
    from sync_assets import read_sync_asset


def apply_sync_window_icon(window):
    """Apply the icon to this window and any future windows in its Tk interpreter."""
    import tkinter as tk

    try:
        from PIL import Image, ImageTk

        with Image.open(BytesIO(read_sync_asset('icon.ico')), formats=['ICO']) as icon:
            photos = tuple(
                ImageTk.PhotoImage(icon.ico.getimage(size).convert('RGBA'), master=window)
                for size in sorted(icon.ico.sizes())
            )
        window.iconphoto(True, *photos)
        # Windows Tk also needs an explicit assignment for an existing window.
        window.iconphoto(False, *photos)
    except (ImportError, OSError, ValueError, tk.TclError):
        return False
    return True
