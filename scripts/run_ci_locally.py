#!/usr/bin/env python3
"""Local Continuous Integration (CI) runner for the Jira Dashboard project.

Supports both fast native host verification (~1-2s) and full containerized
GitHub Actions simulation using nektos/act.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Terminal ANSI color codes
GREEN = "\033[0;32m"
RED = "\033[0;31m"
BLUE = "\033[0;34m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"  # No Color


def format_duration(seconds: float) -> str:
    """Format elapsed seconds into a readable string."""
    if seconds < 1.0:
        return f"{seconds * 1000:.0f}ms"
    return f"{seconds:.2f}s"


def run_command(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Execute a command and stream or return output."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    return subprocess.run(
        cmd,
        cwd=cwd,
        env=full_env,
        check=True,
        text=True,
        capture_output=capture_output,
    )


def validate_ci_workflow(workflow_path: Path) -> None:
    """Validate that the GitHub Actions workflow YAML is syntactically sound."""
    try:
        import yaml
    except ImportError:
        print(
            f"  {YELLOW}Warning: PyYAML is not installed. Skipping deep YAML structure check.{NC}"
        )
        return

    with open(workflow_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict):
        raise TypeError(
            "Workflow file does not contain a valid YAML dictionary mapping."
        )

    jobs = data.get("jobs", {})
    if "backend" not in jobs:
        raise ValueError("Missing 'backend' job definition in ci.yml")
    if "frontend" not in jobs:
        raise ValueError("Missing 'frontend' job definition in ci.yml")


def run_native_pipeline(project_root: Path) -> int:
    """Run all quality, lint, and test checks directly on the local host."""
    print(
        f"{BLUE}{BOLD}=== Starting Fast Local CI Pipeline Verification (Native Mode) ==={NC}"
    )
    print(
        f"{YELLOW}(Tip: Run './scripts/run_ci_locally.py --act' to simulate GitHub Actions in Docker){NC}\n"
    )

    steps: list[
        tuple[str, list[str] | callable, Path | None, dict[str, str] | None]
    ] = [
        (
            "Step 1: Validating .github/workflows/ci.yml syntax...",
            lambda: validate_ci_workflow(
                project_root / ".github" / "workflows" / "ci.yml"
            ),
            project_root,
            None,
        ),
        (
            "Step 2: Checking Backend code quality with Ruff...",
            [sys.executable, "-m", "ruff", "check", "backend/"],
            project_root,
            None,
        ),
        (
            "Step 2b: Checking Backend formatting with Ruff...",
            [sys.executable, "-m", "ruff", "format", "--check", "backend/"],
            project_root,
            None,
        ),
        (
            "Step 3: Running Backend tests (pytest & unittest)...",
            [sys.executable, "-m", "pytest", "backend/tests"],
            project_root,
            {"PYTHONPATH": str(project_root / "backend" / "src")},
        ),
        (
            "Step 3b: Running Backend tests (standard unittest runner)...",
            [sys.executable, "-m", "unittest", "discover", "-s", "backend/tests"],
            project_root,
            {"PYTHONPATH": str(project_root / "backend" / "src")},
        ),
        (
            "Step 4: Running Frontend unit tests (Vitest)...",
            ["npx", "pnpm", "--dir", "frontend", "test"],
            project_root,
            None,
        ),
        (
            "Step 5: Running Frontend typecheck & production build (tsc -b && vite build)...",
            ["npx", "pnpm", "--dir", "frontend", "build"],
            project_root,
            None,
        ),
    ]

    total_start = time.perf_counter()

    for description, cmd_or_func, cwd, env in steps:
        print(f"{CYAN}{description}{NC}")
        step_start = time.perf_counter()
        try:
            if callable(cmd_or_func):
                cmd_or_func()
            else:
                run_command(cmd_or_func, cwd=cwd, env=env)
            duration = format_duration(time.perf_counter() - step_start)
            print(f"{GREEN}✓ Completed in {duration}.{NC}\n")
        except subprocess.CalledProcessError as exc:
            print(f"\n{RED}{BOLD}✗ Command failed with exit code {exc.returncode}:{NC}")
            print(
                f"  Command: {' '.join(exc.cmd if isinstance(exc.cmd, list) else [str(exc.cmd)])}\n"
            )
            return exc.returncode
        except (ValueError, TypeError, OSError, RuntimeError) as exc:
            print(f"\n{RED}{BOLD}✗ Verification step failed: {exc}{NC}\n")
            return 1

    total_duration = format_duration(time.perf_counter() - total_start)
    print(f"{GREEN}{BOLD}============================================={NC}")
    print(
        f"{GREEN}{BOLD}🎉 All Local CI Verification Checks Passed! ({total_duration}) 🎉{NC}"
    )
    print(f"{GREEN}{BOLD}============================================={NC}")
    return 0


def verify_act_prerequisites() -> tuple[bool, str]:
    """Verify that 'act' and the Docker daemon are available."""
    if not shutil.which("act"):
        msg = (
            f"{RED}Error: 'act' is not installed.{NC}\n"
            f"To install 'act' on macOS: {BLUE}brew install act{NC}\n"
            "For other systems, see: https://github.com/nektos/act"
        )
        return False, msg

    try:
        run_command(["docker", "info"], capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        msg = (
            f"{RED}Error: Docker daemon is not running or not accessible.{NC}\n"
            "Please start Docker Desktop (or your Docker engine) to run containerized GitHub Actions."
        )
        return False, msg

    return True, ""


def run_act_pipeline(project_root: Path, act_args: list[str]) -> int:
    """Run the GitHub Actions workflow using nektos/act in Docker."""
    print(f"{BLUE}{BOLD}=== Running GitHub Actions Workflow with 'act' ==={NC}")

    ready, message = verify_act_prerequisites()
    if not ready:
        print(message, file=sys.stderr)
        return 1

    act_flags: list[str] = []

    # Configure emulation architecture for Apple Silicon macOS
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        act_flags.extend(["--container-architecture", "linux/amd64"])
        print(
            f"{YELLOW}Notice: Using --container-architecture linux/amd64 for Apple Silicon.{NC}"
        )

    cmd = ["act", *act_flags, *act_args]
    print(f"{CYAN}Executing: {' '.join(cmd)}{NC}\n")

    try:
        if hasattr(os, "execvp"):
            os.execvp("act", cmd)
        else:
            proc = subprocess.run(cmd, cwd=project_root, check=False)
            return proc.returncode
    except OSError as exc:
        print(f"{RED}Error running 'act': {exc}{NC}", file=sys.stderr)
        return 1

    return 0


def build_parser() -> argparse.ArgumentParser:
    """Construct command-line argument parser."""
    parser = argparse.ArgumentParser(
        description="Run local Continuous Integration checks for the Jira Dashboard project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ./scripts/run_ci_locally.py                     # Fast local checks (recommended for TDD)
  ./scripts/run_ci_locally.py --act               # Full GitHub Actions simulation in Docker
  ./scripts/run_ci_locally.py --act -j backend    # Run only backend job (all Python matrix versions)
  ./scripts/run_ci_locally.py --act --dry-run     # Validate workflow graph without starting containers
  ./scripts/run_ci_locally.py -l                  # List all jobs defined in .github/workflows
        """,
    )

    mode_group = parser.add_argument_group("Execution Modes")
    mode_group.add_argument(
        "--act",
        "--docker",
        dest="use_act",
        action="store_true",
        help="Run GitHub Actions workflow inside Docker containers via 'act'.",
    )
    mode_group.add_argument(
        "--native",
        dest="use_native",
        action="store_true",
        help="Force fast native checks directly on your host (default).",
    )

    act_group = parser.add_argument_group(
        "Docker / act Options (automatically activates --act)"
    )
    act_group.add_argument(
        "-j",
        "--job",
        dest="job",
        metavar="NAME",
        help="Run only a specific workflow job (e.g. 'backend' or 'frontend').",
    )
    act_group.add_argument(
        "-n",
        "-d",
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="Dry-run mode for 'act' (validates workflow graph without running containers).",
    )
    act_group.add_argument(
        "-l",
        "--list",
        dest="list_jobs",
        action="store_true",
        help="List all available workflow jobs using 'act -l'.",
    )

    return parser


def main() -> int:
    """CLI entrypoint."""
    project_root = Path(__file__).resolve().parent.parent

    parser = build_parser()
    args, unknown_args = parser.parse_known_args()

    # Determine if act mode is triggered (either explicitly or via act flags)
    is_act_mode = (
        args.use_act or bool(args.job) or args.dry_run or args.list_jobs
    ) and not args.use_native

    if is_act_mode:
        act_args: list[str] = []
        if args.job:
            act_args.extend(["-j", args.job])
        if args.dry_run:
            act_args.append("-n")
        if args.list_jobs:
            act_args.append("-l")
        act_args.extend(unknown_args)
        return run_act_pipeline(project_root, act_args)

    if unknown_args:
        print(
            f"{RED}Error: Unrecognized arguments: {' '.join(unknown_args)}{NC}",
            file=sys.stderr,
        )
        parser.print_help(sys.stderr)
        return 2

    return run_native_pipeline(project_root)


if __name__ == "__main__":
    sys.exit(main())
