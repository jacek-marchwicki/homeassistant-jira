#!/usr/bin/env python3
"""Google Cloud Secret Manager Backup & Restore Automation.

Provides safe, audited backup and restoration of repository secrets and gitignored
credentials (such as .env.gcp, Android signing keys, and keystore configurations)
to/from Google Cloud Secret Manager.

Cost and safety guarantees:
- Secret Manager storage of a few secrets is within Google Cloud Always Free tier.
- Accidental project collisions are prevented by strictly requiring explicit project ID
  from CLI (--project) or .env.gcp (GCP_PROJECT_ID); no implicit gcloud active project fallback.
- Local files are protected from accidental overwrite during restore unless --force is specified.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Terminal ANSI color codes
GREEN = "\033[0;32m"
RED = "\033[0;31m"
BLUE = "\033[0;34m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"  # No Color

DEFAULT_PREFIX = "ha-jira-backup-"


@dataclass(frozen=True)
class SecretSpec:
    """Specification of a repository secret mapped to GCP Secret Manager."""

    relative_path: Path
    secret_id: str
    description: str
    is_binary: bool = False
    mirror_paths: tuple[Path, ...] = ()
    is_optional: bool = False


def print_step(msg: str) -> None:
    """Print formatted step banner."""
    print(f"\n{BLUE}{BOLD}==> {msg}{NC}")


def print_success(msg: str) -> None:
    """Print success message."""
    print(f"{GREEN}✓ {msg}{NC}")


def print_warning(msg: str) -> None:
    """Print warning message."""
    print(f"{YELLOW}⚠ {msg}{NC}")


def print_error(msg: str) -> None:
    """Print error message."""
    print(f"{RED}✗ {msg}{NC}", file=sys.stderr)


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    capture_output: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Execute a system command returning string output."""
    try:
        return subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            check=True,
            capture_output=capture_output,
            input=input_text,
        )
    except subprocess.CalledProcessError as exc:
        if exc.stderr:
            # Only print if needed for diagnosis
            pass
        raise


def run_cmd_bytes(
    cmd: list[str],
    cwd: Path | None = None,
) -> subprocess.CompletedProcess[bytes]:
    """Execute a system command returning raw byte output (for binary files/keystores)."""
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        capture_output=True,
    )


def check_gcloud_prerequisites() -> None:
    """Verify that gcloud is installed and authenticated."""
    if not shutil.which("gcloud"):
        print_error("Google Cloud SDK ('gcloud') is not installed or not in PATH.")
        print(
            "Please install gcloud from: https://cloud.google.com/sdk/docs/install",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        res = run_cmd(
            [
                "gcloud",
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ]
        )
        active_account = res.stdout.strip()
        if not active_account:
            print_error("No active gcloud account authenticated.")
            print("Please run: gcloud auth login", file=sys.stderr)
            sys.exit(1)
    except (subprocess.SubprocessError, OSError) as exc:
        print_error(f"Failed to check gcloud authentication: {exc}")
        sys.exit(1)


def load_env_file(env_path: Path) -> dict[str, str]:
    """Parse local key=value .env file without external dependencies."""
    if not env_path.is_file():
        return {}

    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        if "=" in trimmed:
            k, v = trimmed.split("=", 1)
            k = k.strip()
            v = v.strip().strip("'\"")
            if k and v:
                values[k] = v
    return values


def resolve_project_id(cli_project: str | None, config: dict[str, str]) -> str:
    """Resolve target GCP project ID.

    Strictly requires explicit CLI argument or .env.gcp configuration.
    Deliberately avoids falling back to `gcloud config get-value project` to prevent
    unintended deployments/uploads to incorrect GCP projects.
    """
    if cli_project and cli_project.strip():
        return cli_project.strip()

    config_project = config.get("GCP_PROJECT_ID", "").strip()
    if config_project:
        return config_project

    print_error(
        "GCP Project ID is required. Please specify it via --project <PROJECT_ID> "
        "or configure GCP_PROJECT_ID in .env.gcp."
    )
    sys.exit(1)


def get_secret_specs(prefix: str = DEFAULT_PREFIX) -> list[SecretSpec]:
    """Return canonical repository secret specifications."""
    return [
        SecretSpec(
            relative_path=Path(".env.gcp"),
            secret_id=f"{prefix}env-gcp",
            description="Cloud Run & GCP deployment configuration (.env.gcp)",
            is_binary=False,
            is_optional=False,
        ),
        SecretSpec(
            relative_path=Path(".env"),
            secret_id=f"{prefix}env",
            description="Local development backend environment (.env)",
            is_binary=False,
            is_optional=True,
        ),
        SecretSpec(
            relative_path=Path("android/keystore.properties"),
            secret_id=f"{prefix}android-keystore-properties",
            description="Android release signing configuration (keystore.properties)",
            is_binary=False,
            mirror_paths=(Path("android/app/keystore.properties"),),
            is_optional=False,
        ),
        SecretSpec(
            relative_path=Path("android/app/release.jks"),
            secret_id=f"{prefix}android-release-jks",
            description="Android release keystore private certificate (release.jks)",
            is_binary=True,
            is_optional=False,
        ),
        SecretSpec(
            relative_path=Path("secrets.yaml"),
            secret_id=f"{prefix}secrets-yaml",
            description="Home Assistant secrets configuration (secrets.yaml)",
            is_binary=False,
            is_optional=True,
        ),
        SecretSpec(
            relative_path=Path("options.json"),
            secret_id=f"{prefix}options-json",
            description="Home Assistant Add-on runtime configuration (options.json)",
            is_binary=False,
            is_optional=True,
        ),
    ]


def execute_status(
    repo_root: Path,
    project_id: str,
    prefix: str = DEFAULT_PREFIX,
) -> None:
    """Inspect and report the status of repository secrets locally and in GCP."""
    print_step(f"Repository Secrets Status (GCP Project: '{project_id}')")
    specs = get_secret_specs(prefix)

    header = f"{'Relative File':<32} {'Local':<12} {'Size':<10} {'GCP Secret ID':<40} {'Remote Status'}"
    print(f"\n{BOLD}{header}{NC}")
    print("-" * len(header))

    for spec in specs:
        local_file = repo_root / spec.relative_path
        if local_file.is_file():
            local_status = f"{GREEN}Present{NC}"
            size_bytes = local_file.stat().st_size
            size_str = (
                f"{size_bytes} B"
                if size_bytes < 1024
                else f"{size_bytes / 1024:.1f} KB"
            )
        else:
            local_status = (
                f"{YELLOW}Missing{NC}" if spec.is_optional else f"{RED}Missing{NC}"
            )
            size_str = "-"

        # Check GCP Secret Manager
        try:
            res = run_cmd(
                [
                    "gcloud",
                    "secrets",
                    "describe",
                    spec.secret_id,
                    f"--project={project_id}",
                    "--format=value(createTime)",
                ]
            )
            created_at = res.stdout.strip()
            remote_status = f"{GREEN}Exists{NC} (Created: {created_at[:10]})"
        except (subprocess.CalledProcessError, OSError):
            remote_status = f"{YELLOW}Not found in GCP{NC}"

        file_display = str(spec.relative_path)
        print(
            f"{file_display:<32} {local_status:<21} {size_str:<10} {spec.secret_id:<40} {remote_status}"
        )


def execute_backup(
    repo_root: Path,
    project_id: str,
    prefix: str = DEFAULT_PREFIX,
    dry_run: bool = False,
) -> None:
    """Backup existing local secret files to GCP Secret Manager."""
    print_step(f"Backing up secrets to GCP Secret Manager (Project: '{project_id}')")
    if dry_run:
        print_warning("Running in DRY-RUN mode. No changes will be written to GCP.")

    specs = get_secret_specs(prefix)
    uploaded_count = 0

    for spec in specs:
        local_file = repo_root / spec.relative_path
        if not local_file.is_file():
            if spec.is_optional:
                print(
                    f"  • Skipping optional file (not present locally): {spec.relative_path}"
                )
            else:
                print_warning(
                    f"Required file not found locally, skipping: {spec.relative_path}"
                )
            continue

        print(
            f"\n  • Processing {BOLD}{spec.relative_path}{NC} -> {CYAN}{spec.secret_id}{NC}"
        )

        if dry_run:
            print(
                f"    [DRY-RUN] Would create secret '{spec.secret_id}' if missing and upload version."
            )
            uploaded_count += 1
            continue

        # Check if secret exists in GCP
        exists_check = subprocess.run(
            [
                "gcloud",
                "secrets",
                "describe",
                spec.secret_id,
                f"--project={project_id}",
            ],
            capture_output=True,
            check=False,
        )

        if exists_check.returncode != 0:
            print(f"    Creating secret in GCP Secret Manager: {spec.secret_id}...")
            run_cmd(
                [
                    "gcloud",
                    "secrets",
                    "create",
                    spec.secret_id,
                    "--replication-policy=automatic",
                    f"--project={project_id}",
                    "--labels=app=homeassistant-jira,type=repo-backup",
                ]
            )
        else:
            print(f"    Secret exists in GCP: {spec.secret_id}")

        # Add new version from file
        print(f"    Uploading payload version from {spec.relative_path}...")
        run_cmd(
            [
                "gcloud",
                "secrets",
                "versions",
                "add",
                spec.secret_id,
                f"--data-file={local_file.resolve()}",
                f"--project={project_id}",
            ]
        )
        print_success(f"Uploaded {spec.relative_path} to secret {spec.secret_id}")
        uploaded_count += 1

    if dry_run:
        print_step(
            f"[DRY-RUN] Completed plan. {uploaded_count} secrets evaluated for backup."
        )
    else:
        print_step(
            f"Backup completed successfully. {uploaded_count} secret(s) backed up."
        )


def execute_restore(
    repo_root: Path,
    project_id: str,
    prefix: str = DEFAULT_PREFIX,
    force: bool = False,
    dry_run: bool = False,
) -> None:
    """Restore secrets from GCP Secret Manager into repository files."""
    print_step(f"Restoring secrets from GCP Secret Manager (Project: '{project_id}')")
    if dry_run:
        print_warning("Running in DRY-RUN mode. No files will be modified on disk.")

    specs = get_secret_specs(prefix)
    restored_count = 0

    for spec in specs:
        local_file = repo_root / spec.relative_path
        if local_file.exists() and not force:
            print_warning(
                f"File already exists locally: {spec.relative_path}. "
                "Skipping to prevent overwrite (use --force to overwrite)."
            )
            continue

        # Download secret payload from GCP
        try:
            res = run_cmd_bytes(
                [
                    "gcloud",
                    "secrets",
                    "versions",
                    "access",
                    "latest",
                    f"--secret={spec.secret_id}",
                    f"--project={project_id}",
                ]
            )
        except (subprocess.CalledProcessError, OSError):
            if spec.is_optional:
                print(
                    f"  • Optional secret '{spec.secret_id}' not found in GCP Secret Manager, skipping."
                )
            else:
                print_warning(
                    f"Secret '{spec.secret_id}' not found in GCP Secret Manager."
                )
            continue

        payload = res.stdout

        if dry_run:
            print(
                f"  • [DRY-RUN] Would write {len(payload)} bytes to {spec.relative_path}"
            )
            for mirror in spec.mirror_paths:
                print(f"  • [DRY-RUN] Would mirror payload to {mirror}")
            restored_count += 1
            continue

        # Write primary target
        local_file.parent.mkdir(parents=True, exist_ok=True)
        local_file.write_bytes(payload)
        print_success(f"Restored: {spec.relative_path} ({len(payload)} bytes)")
        restored_count += 1

        # Write any mirrored copies (e.g. android/app/keystore.properties)
        for mirror in spec.mirror_paths:
            mirror_file = repo_root / mirror
            mirror_file.parent.mkdir(parents=True, exist_ok=True)
            mirror_file.write_bytes(payload)
            print_success(f"Mirrored: {mirror}")

    if dry_run:
        print_step(
            f"[DRY-RUN] Completed plan. {restored_count} secrets evaluated for restore."
        )
    else:
        print_step(
            f"Restore completed successfully. {restored_count} secret(s) restored."
        )


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Backup and restore repository secrets to/from Google Cloud Secret Manager."
    )
    parser.add_argument(
        "action",
        choices=["status", "backup", "restore"],
        help="Action to execute: 'status', 'backup', or 'restore'.",
    )
    parser.add_argument(
        "--project",
        "-p",
        default=None,
        help="GCP Project ID (defaults to GCP_PROJECT_ID in .env.gcp).",
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help="Path to custom .env.gcp configuration file.",
    )
    parser.add_argument(
        "--prefix",
        default=DEFAULT_PREFIX,
        help=f"Prefix for GCP Secret Manager secret IDs (default: '{DEFAULT_PREFIX}').",
    )
    parser.add_argument(
        "--force",
        "-f",
        action="store_true",
        help="Overwrite existing local files during restore.",
    )
    parser.add_argument(
        "--dry-run",
        "-n",
        action="store_true",
        help="Simulate the action without making modifications to GCP or local disk.",
    )

    args = parser.parse_args()

    # Determine repository root
    repo_root = Path(__file__).resolve().parent.parent

    # Load configuration from .env.gcp if present
    env_file = (
        Path(args.env_file).resolve() if args.env_file else repo_root / ".env.gcp"
    )
    config = load_env_file(env_file)

    # Check gcloud authentication and prerequisites
    check_gcloud_prerequisites()

    # Resolve project ID strictly without gcloud config fallback
    project_id = resolve_project_id(cli_project=args.project, config=config)

    if args.action == "status":
        execute_status(repo_root=repo_root, project_id=project_id, prefix=args.prefix)
    elif args.action == "backup":
        execute_backup(
            repo_root=repo_root,
            project_id=project_id,
            prefix=args.prefix,
            dry_run=args.dry_run,
        )
    elif args.action == "restore":
        execute_restore(
            repo_root=repo_root,
            project_id=project_id,
            prefix=args.prefix,
            force=args.force,
            dry_run=args.dry_run,
        )


if __name__ == "__main__":
    main()
