#!/usr/bin/env python3
"""PWA icon generator CLI script for the Jira Dashboard project.

Executes the icon generation pipeline to create SVG and PNG assets
(including Android adaptive maskable icons) from the source vector definition.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    """Execute the Node.js icon generator script."""
    project_root = Path(__file__).resolve().parent.parent
    generator_script = project_root / "scripts" / "generate_icons.mjs"

    if not shutil.which("node"):
        print("Error: 'node' executable not found on PATH.", file=sys.stderr)
        return 1

    cmd = ["node", str(generator_script)]
    try:
        res = subprocess.run(cmd, cwd=project_root, check=True)
        return res.returncode
    except subprocess.CalledProcessError as exc:
        print(f"Error running icon generator: {exc}", file=sys.stderr)
        return exc.returncode


if __name__ == "__main__":
    sys.exit(main())
