from __future__ import annotations

import sys


def main() -> int:
    if '--designer' in sys.argv:
        from designer import main as designer_main

        return designer_main()

    from sync_server import main as service_main

    service_main()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
