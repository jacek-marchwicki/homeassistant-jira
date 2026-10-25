#!/usr/bin/env python3
"""Google Cloud Platform & MCP Deployment Automation.

Provides single-command deployment, Secret Manager synchronization,
and status monitoring for the Home Assistant Jira Dashboard & MCP Server
on Google Cloud Run.

Adheres strictly to GCP Always Free Tier quotas and cost-control constraints (< $2/month):
- Scale-to-zero (--min-instances 0)
- Request-only CPU allocation (--cpu-throttling)
- Native HTTPS endpoints (no expensive HTTP(S) Load Balancer)
"""

from __future__ import annotations

import argparse
import secrets
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

REQUIRED_APIS = [
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
]

SECRET_KEYS = [
    "ALLOWED_EMAILS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "JIRA_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_BOARD_ID",
    "GEMINI_API_KEY",
    "SESSION_SECRET_KEY",
]


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
    print(f"{RED}✗ {msg}{NC}")


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    capture_output: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Execute a system command with error reporting."""
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
        print_error(f"Command failed: {' '.join(cmd)}")
        if exc.stdout:
            print(f"Stdout:\n{exc.stdout}")
        if exc.stderr:
            print(f"Stderr:\n{exc.stderr}")
        raise


def check_gcloud_prerequisites() -> None:
    """Verify that the gcloud CLI is installed and user is authenticated."""
    if not shutil.which("gcloud"):
        print_error("Google Cloud SDK ('gcloud') is not installed or not in PATH.")
        print("Please install gcloud from: https://cloud.google.com/sdk/docs/install")
        sys.exit(1)

    try:
        res = run_cmd(
            [
                "gcloud",
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ],
            capture_output=True,
        )
        active_account = res.stdout.strip()
        if not active_account:
            print_error("No active gcloud account authenticated.")
            print("Please run: gcloud auth login")
            sys.exit(1)
        print_success(f"Authenticated as: {active_account}")
    except (subprocess.SubprocessError, OSError) as exc:
        print_error(f"Failed to check gcloud authentication: {exc}")
        sys.exit(1)


def load_env_file(env_path: Path) -> dict[str, str]:
    """Parse local key=value .env file safely without third-party dependencies."""
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


def ensure_env_file(
    project_root: Path, custom_path: str | None = None
) -> tuple[Path, dict[str, str]]:
    """Ensure .env.gcp exists and return parsed configuration."""
    env_file = Path(custom_path).resolve() if custom_path else project_root / ".env.gcp"
    if not env_file.is_file():
        example_file = project_root / ".env.gcp.example"
        print_error(f"Configuration file not found: {env_file}")
        print(
            f"Please copy the template:\n  cp {example_file} {env_file}\nand populate your credentials."
        )
        sys.exit(1)

    config = load_env_file(env_file)
    return env_file, config


def get_project_number(project_id: str) -> str:
    """Retrieve numeric project number for IAM bindings."""
    res = run_cmd(
        ["gcloud", "projects", "describe", project_id, "--format=value(projectNumber)"],
        capture_output=True,
    )
    return res.stdout.strip()


def ensure_storage_bucket(
    project_id: str,
    bucket_name: str,
    region: str,
    compute_sa: str,
) -> None:
    """Ensure Google Cloud Storage bucket exists for image blobs and SA has objectAdmin permissions."""
    print(f"  • Checking Cloud Storage bucket: gs://{bucket_name}")
    describe_check = subprocess.run(
        ["gcloud", "storage", "buckets", "describe", f"gs://{bucket_name}"],
        capture_output=True,
        check=False,
    )
    if describe_check.returncode != 0:
        print(f"  • Creating bucket gs://{bucket_name} in {region}...")
        run_cmd(
            [
                "gcloud",
                "storage",
                "buckets",
                "create",
                f"gs://{bucket_name}",
                f"--project={project_id}",
                f"--location={region}",
                "--uniform-bucket-level-access",
            ],
            capture_output=True,
        )
    run_cmd(
        [
            "gcloud",
            "storage",
            "buckets",
            "add-iam-policy-binding",
            f"gs://{bucket_name}",
            f"--member=serviceAccount:{compute_sa}",
            "--role=roles/storage.objectAdmin",
        ],
        capture_output=True,
    )
    print_success(f"Configured GCS bucket gs://{bucket_name}")


def ensure_firestore_database(project_id: str, region: str) -> None:
    """Ensure Firestore database exists in Native mode."""
    print(f"  • Checking Firestore database in project '{project_id}'...")
    check = subprocess.run(
        [
            "gcloud",
            "firestore",
            "databases",
            "list",
            f"--project={project_id}",
            "--format=value(name)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if not check.stdout.strip():
        print(f"  • Creating default Firestore database in {region}...")
        run_cmd(
            [
                "gcloud",
                "firestore",
                "databases",
                "create",
                f"--location={region}",
                "--type=firestore-native",
                f"--project={project_id}",
            ],
            capture_output=True,
        )
        print_success(f"Created default Firestore database in {region}.")
    else:
        print_success("Firestore database exists.")


def sync_secrets(project_root: Path, env_path: str | None = None) -> None:
    """Synchronize credentials from .env.gcp into Google Cloud Secret Manager."""
    print_step("Checking prerequisites and loading configuration...")
    check_gcloud_prerequisites()
    _, config = ensure_env_file(project_root, env_path)

    project_id = config.get("GCP_PROJECT_ID")
    if not project_id:
        print_error("GCP_PROJECT_ID is not configured in .env.gcp")
        sys.exit(1)

    print_step(f"Enabling required GCP APIs for project '{project_id}'...")
    for api in REQUIRED_APIS:
        print(f"  • Ensuring {api} is enabled...")
        run_cmd(
            ["gcloud", "services", "enable", api, "--project", project_id],
            capture_output=True,
        )
    print_success("All required APIs are enabled.")

    project_number = get_project_number(project_id)
    compute_sa = f"{project_number}-compute@developer.gserviceaccount.com"
    print_success(f"Default Cloud Run compute service account: {compute_sa}")

    print_step("Ensuring Cloud Storage bucket for image cache...")
    bucket_name = config.get("IMAGE_STORAGE_BUCKET") or f"{project_id}-images"
    region = config.get("GCP_REGION", "europe-west1")
    ensure_storage_bucket(project_id, bucket_name, region, compute_sa)

    print_step("Ensuring Firestore database...")
    ensure_firestore_database(project_id, region)

    print_step(
        "Granting Datastore/Firestore IAM permissions to compute service account..."
    )
    run_cmd(
        [
            "gcloud",
            "projects",
            "add-iam-policy-binding",
            project_id,
            f"--member=serviceAccount:{compute_sa}",
            "--role=roles/datastore.user",
        ],
        capture_output=True,
    )
    print_success("Granted roles/datastore.user to compute service account.")

    print_step("Provisioning secrets in GCP Secret Manager...")
    if not config.get("SESSION_SECRET_KEY"):
        config["SESSION_SECRET_KEY"] = secrets.token_hex(32)
        print_warning("Generated random 256-bit SESSION_SECRET_KEY for session tokens.")

    for key in SECRET_KEYS:
        val = config.get(key)
        if not val:
            continue

        secret_id = key.lower().replace("_", "-")
        # Check if secret exists
        exists_check = subprocess.run(
            ["gcloud", "secrets", "describe", secret_id, "--project", project_id],
            capture_output=True,
            check=False,
        )

        if exists_check.returncode != 0:
            print(f"  • Creating new secret: {secret_id}")
            run_cmd(
                [
                    "gcloud",
                    "secrets",
                    "create",
                    secret_id,
                    "--replication-policy=automatic",
                    "--project",
                    project_id,
                ],
                capture_output=True,
            )
        else:
            print(f"  • Secret exists: {secret_id}")

        # Add secret payload version
        run_cmd(
            [
                "gcloud",
                "secrets",
                "versions",
                "add",
                secret_id,
                "--data-file=-",
                "--project",
                project_id,
            ],
            input_text=val,
            capture_output=True,
        )

        # Grant access to Cloud Run compute service account
        run_cmd(
            [
                "gcloud",
                "secrets",
                "add-iam-policy-binding",
                secret_id,
                f"--member=serviceAccount:{compute_sa}",
                "--role=roles/secretmanager.secretAccessor",
                "--project",
                project_id,
            ],
            capture_output=True,
        )
        print_success(f"Synced & secured secret: {secret_id}")

    print_step("Secret Manager synchronization complete!")
    print(
        f"{GREEN}{BOLD}All credentials are encrypted and stored inside Google Cloud Secret Manager.{NC}"
    )


def build_deploy_command(project_root: Path, config: dict[str, str]) -> list[str]:
    """Construct full 'gcloud run deploy' command with env vars."""
    project_id = config.get("GCP_PROJECT_ID", "")
    region = config.get("GCP_REGION", "europe-west1")
    service_name = config.get("GCP_SERVICE_NAME", "homeassistant-jira")

    secret_bindings: list[str] = []
    for key in SECRET_KEYS:
        if config.get(key):
            secret_id = key.lower().replace("_", "-")
            secret_bindings.append(f"{key}={secret_id}:latest")

    bucket_name = config.get("IMAGE_STORAGE_BUCKET") or f"{project_id}-images"
    env_vars = [
        "AUTH_MODE=gcp_oauth",
        "STORAGE_BACKEND=firestore",
        "IMAGE_STORAGE_BACKEND=gcs",
        f"IMAGE_STORAGE_BUCKET={bucket_name}",
        f"GCP_PROJECT_ID={project_id}",
    ]
    if config.get("FIRESTORE_DATABASE_ID"):
        env_vars.append(f"FIRESTORE_DATABASE_ID={config['FIRESTORE_DATABASE_ID']}")

    deploy_cmd: list[str] = [
        "gcloud",
        "run",
        "deploy",
        service_name,
        "--project",
        project_id,
        "--region",
        region,
        "--source",
        str(project_root),
        "--platform",
        "managed",
        "--allow-unauthenticated",
        "--port",
        "8000",
        "--min-instances",
        "0",  # Cost control: scale to 0 when idle
        "--max-instances",
        "2",  # Cost control: cap scaling to prevent runaway bills
        "--cpu-throttling",  # Cost control: only charged during active request execution
        "--memory",
        "512Mi",
        "--concurrency",
        "80",
        "--set-env-vars",
        ",".join(env_vars),
    ]

    if secret_bindings:
        deploy_cmd.extend(["--set-secrets", ",".join(secret_bindings)])

    return deploy_cmd


def deploy_service(
    project_root: Path,
    env_path: str | None = None,
    skip_ci: bool = False,
) -> None:
    """Build and deploy application to Google Cloud Run."""
    start_time = time.time()
    _, config = ensure_env_file(project_root, env_path)

    project_id = config.get("GCP_PROJECT_ID")
    region = config.get("GCP_REGION", "europe-west1")
    service_name = config.get("GCP_SERVICE_NAME", "homeassistant-jira")

    if not project_id:
        print_error("GCP_PROJECT_ID is not configured in .env.gcp")
        sys.exit(1)

    if not skip_ci:
        print_step("Running Local Pre-Deployment CI Verification...")
        ci_script = project_root / "scripts" / "run_ci_locally.py"
        if ci_script.is_file():
            run_cmd([sys.executable, str(ci_script)], cwd=project_root)
            print_success("Pre-deployment CI passed with 100% success!")
        else:
            print_warning("Local CI runner not found, skipping baseline checks.")

    print_step(f"Deploying '{service_name}' to Cloud Run in region '{region}'...")
    deploy_cmd = build_deploy_command(project_root, config)
    run_cmd(deploy_cmd, cwd=project_root)

    # Retrieve public service URL
    url_res = run_cmd(
        [
            "gcloud",
            "run",
            "services",
            "describe",
            service_name,
            "--project",
            project_id,
            "--region",
            region,
            "--format=value(status.url)",
        ],
        capture_output=True,
    )
    service_url = url_res.stdout.strip()
    elapsed = time.time() - start_time

    print_step("Deployment Successful! 🎉")
    print(f"\n{BOLD}{GREEN}Deployment completed in {elapsed:.1f}s{NC}\n")
    print(f"{BOLD}Web Dashboard URL:{NC}       {CYAN}{service_url}/{NC}")
    print(f"{BOLD}Gemini MCP SSE URL:{NC}      {CYAN}{service_url}/sse{NC}")
    print(f"{BOLD}Gemini MCP Stream URL:{NC}   {CYAN}{service_url}/mcp{NC}")
    print(f"\n{BOLD}Connecting to Gemini on Web (gemini.com):{NC}")
    print("  1. Go to Gemini Settings -> Custom Tools / MCP Servers")
    print(f"  2. Server URL:     {service_url}/sse")
    print(
        f"  3. Client ID:      {config.get('GOOGLE_CLIENT_ID', '<YOUR_GOOGLE_CLIENT_ID>')}"
    )
    print("  4. Client Secret:  <Your Google OAuth Client Secret>")
    print(
        f"\n{YELLOW}Note: Only the authorized accounts ({config.get('ALLOWED_EMAILS', '')}) can authenticate.{NC}\n"
    )


def check_status(project_root: Path, env_path: str | None = None) -> None:
    """Display status and recent logs for the deployed Cloud Run service."""
    _, config = ensure_env_file(project_root, env_path)
    project_id = config.get("GCP_PROJECT_ID")
    region = config.get("GCP_REGION", "europe-west1")
    service_name = config.get("GCP_SERVICE_NAME", "homeassistant-jira")

    print_step(f"Fetching status for '{service_name}' ({region})...")
    run_cmd(
        [
            "gcloud",
            "run",
            "services",
            "describe",
            service_name,
            "--project",
            project_id,
            "--region",
            region,
        ]
    )


def main() -> None:
    """Main CLI entrypoint."""
    project_root = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="Deploy and manage Home Assistant Jira Dashboard & MCP Server on GCP Cloud Run."
    )
    parser.add_argument(
        "--env-file",
        help="Path to custom .env file (defaults to .env.gcp at project root)",
        default=None,
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: sync-secrets
    subparsers.add_parser(
        "sync-secrets",
        help="Synchronize credentials from .env.gcp into GCP Secret Manager.",
    )

    # Subcommand: deploy
    deploy_parser = subparsers.add_parser(
        "deploy",
        help="Build and deploy the application container to Google Cloud Run.",
    )
    deploy_parser.add_argument(
        "--skip-ci",
        action="store_true",
        help="Skip pre-deployment local CI checks",
    )

    # Subcommand: status
    subparsers.add_parser(
        "status",
        help="Display status and metrics for the Cloud Run service.",
    )

    args = parser.parse_args()

    try:
        if args.command == "sync-secrets":
            sync_secrets(project_root, args.env_file)
        elif args.command == "deploy":
            deploy_service(project_root, args.env_file, skip_ci=args.skip_ci)
        elif args.command == "status":
            check_status(project_root, args.env_file)
    except subprocess.CalledProcessError as exc:
        print_error(f"Operation failed with exit code {exc.returncode}")
        sys.exit(exc.returncode)
    except KeyboardInterrupt:
        print_warning("\nOperation interrupted by user.")
        sys.exit(130)


if __name__ == "__main__":
    main()
