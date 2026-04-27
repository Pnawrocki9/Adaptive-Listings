"""
Modal environment verification script.

Modal does not have a Terraform provider. Instead, we manage Modal apps via
Modal CLI + Python decorators (code-as-config).

To set up Modal infra:
  pip install modal
  modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET
  python infra/terraform/modal/modal-config/modal_setup.py

Real app deployment: each app deploys itself via `modal deploy apps/<app>/src/main.py`
in CI. This script just verifies environment is ready.
"""

import os
import sys


def verify_env():
    """Verify required Modal environment variables are set."""
    required = ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        print(f"Error: Missing environment variables: {missing}", file=sys.stderr)
        print("\nTo fix:", file=sys.stderr)
        print("  1. Generate token: https://modal.com/settings/tokens", file=sys.stderr)
        print("  2. Store in Doppler:", file=sys.stderr)
        print("     doppler secrets set MODAL_TOKEN_ID=<id>", file=sys.stderr)
        print("     doppler secrets set MODAL_TOKEN_SECRET=<secret>", file=sys.stderr)
        print("  3. Run with doppler: doppler run -- python modal_setup.py", file=sys.stderr)
        sys.exit(1)
    print("✓ Modal environment variables OK.")


def check_modal_installed():
    """Check if Modal CLI is installed."""
    try:
        import modal

        print(f"✓ Modal library installed (version {modal.__version__}).")
    except ImportError:
        print("Error: Modal library not installed.", file=sys.stderr)
        print("Install with: pip install modal", file=sys.stderr)
        sys.exit(1)


def main():
    print("Modal environment verification\n" + "=" * 40)
    check_modal_installed()
    verify_env()
    print("\nModal setup complete. Ready to deploy apps.")
    print("\nNext steps:")
    print("  1. Authenticate CLI: modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET")
    print("  2. Deploy an app: modal deploy apps/<app>/src/main.py")
    print("  3. View logs: modal logs <app-name>")


if __name__ == "__main__":
    main()
