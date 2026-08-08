#!/usr/bin/env python3
"""Modal local-source gate: every LOCAL module a deployed Modal app imports must be
declared on that app's image via ``add_local_python_source`` [FOLLOW-900].

WHY THIS GATE EXISTS
--------------------
``modal deploy`` only REGISTERS functions. It imports the entrypoint on the runner,
uploads the app graph, and reports success. It never starts a container, so it cannot
observe whether the image it just registered can even be IMPORTED. FOLLOW-900 is the bill
for that gap: ``estalara-schema-validation`` deployed green on 2026-08-07, was listed
``deployed`` by ``modal app list``, held a registered ``modal.Cron("0 2 * * *")``, and
every single container died at line 58 of its own module::

    from crons.observability import flush_sentry, init_sentry
    ModuleNotFoundError: No module named 'crons'

Nothing alerted, because the failing import IS the Sentry init. The nightly job wrote
zero rows for its entire life while every badge stayed green.

THE UNDERLYING TRAP (verified against modal 1.4.2 source, not from memory)
-------------------------------------------------------------------------
Modal removed automounting of local Python source in 1.0. What remains is an IMPLICIT
"entrypoint mount", and its shape is decided in
``modal/_utils/function_utils.py::FunctionInfo.__init__`` by exactly one thing —
whether the module defining the ``@app.function`` has a truthy ``__package__``:

  * ``FunctionInfoType.PACKAGE`` → the WHOLE top-level package is mounted.
    (``apps/llm-gateway``: its functions live in ``jobs.generate_description``, so
    ``jobs/`` is mounted and the app works — by accident of layout, not by declaration.)
  * ``FunctionInfoType.FILE``    → ONLY that one file is mounted, flattened to
    ``/root/<stem>.py``. Its siblings and its own package are NOT shipped.
    (``apps/data-quality``: ``modal deploy .../crons/schema_validation.py`` imports the
    file by path, so ``__package__`` is empty → FILE → ``/root/schema_validation.py``
    alone → ``crons`` absent. Exactly the traceback above.)

So whether an app's local imports survive deployment depends on an invisible property of
how its entrypoint happens to be loaded. That is not a thing anyone should have to hold in
their head at review time. This gate replaces it with an explicit, checkable declaration:
if a deployed app imports a local module, that module must be named in
``add_local_python_source(...)``. The implicit mount may still do the work at runtime —
the gate simply refuses to let an app DEPEND on it silently.

WHAT IS ASSERTED
----------------
For every entrypoint in REGISTRY:
  1. Walk the entrypoint's AST for imports — at ANY nesting depth. Function-body imports
     are the dangerous case and the reason a "module-level imports look fine" reading is
     not enough: ``apps/intent-engine/src/main.py:82-83`` imports ``nlp`` and
     ``redis_writer`` INSIDE ``process_chat_message``, so the defect only ever surfaces on
     invocation, in a ``.spawn()``-ed function nobody is watching.
  2. Resolve each imported top-level name against the app's source root. A name that
     resolves to a file/package there is LOCAL and is a requirement.
  3. Recurse through those local modules transitively (skipping test files).
  4. Collect every ``add_local_python_source("a", "b")`` argument found anywhere in the
     app's source root — that is the DECLARED set.
  5. Fail if required ⊄ declared.
  6. Fail if ``.github/workflows/modal-deploy.yml`` deploys an entrypoint this REGISTRY
     does not cover — a fourth Modal app cannot quietly opt out of the gate.

WHAT IS *NOT* ASSERTED, stated plainly (Rule AQ)
------------------------------------------------
This is static analysis. It does not execute the app, does not contact Modal, and cannot
prove a container starts. It proves one specific thing: no deployed Modal app imports a
local module that its image never declares. Dynamic imports (``importlib.import_module``
on a computed name) are invisible to it. The complementary runtime proof is invoking the
function — ``modal run`` — which is what FOLLOW-900's AC(2) required and no green deploy
can substitute for.

SELF-TEST (Rule Q — this gate has observed its own failure)
-----------------------------------------------------------
``python3 scripts/check-modal-local-imports.py --self-test`` builds synthetic app trees
and asserts the gate FIRES on all four miss shapes (undeclared top-level import,
undeclared function-body import, undeclared transitive import, uncovered entrypoint in
modal-deploy.yml) and stays SILENT on the declared shape. CI runs the self-test before the
real check, so a broken detector cannot pass the gate.

EXIT CODES
  0  every deployed Modal app declares every local module it imports
  1  violation: an app imports a local module its image does not declare, or an app
     deployed by modal-deploy.yml is not covered by REGISTRY
  2  the gate itself is broken (self-test failure) or was misused (usage error)
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ── Registry ────────────────────────────────────────────────────────────────────────────
# entrypoint (as passed to `modal deploy`) → source root that is on sys.path at deploy time.
# The roots are not cosmetic: `modal deploy <file>` puts the FILE's directory on sys.path,
# which is why modal-deploy.yml sets PYTHONPATH=apps/data-quality/src explicitly — the
# entrypoint lives one level deeper than its package root. Resolution here must mirror the
# path the deploy actually uses, or the gate checks a different program than the one that
# ships.
REGISTRY: dict[str, str] = {
    "apps/llm-gateway/src/main.py": "apps/llm-gateway/src",
    "apps/intent-engine/src/main.py": "apps/intent-engine/src",
    "apps/data-quality/src/crons/schema_validation.py": "apps/data-quality/src",
}

DEPLOY_WORKFLOW = ".github/workflows/modal-deploy.yml"
_DEPLOY_RE = re.compile(r"modal\s+deploy\s+(\S+\.py)")


def _is_test_file(path: Path) -> bool:
    """Test/fixture modules are not shipped to Modal, so their imports are out of scope."""
    return "test" in path.name or path.name == "conftest.py"


def _local_module_file(root: Path, name: str) -> Path | None:
    """Return the file that ``name`` resolves to under *root*, or None if not local."""
    pkg_init = root / name / "__init__.py"
    if pkg_init.is_file():
        return pkg_init
    module = root / f"{name}.py"
    if module.is_file():
        return module
    return None


def _top_level_of(root: Path, file: Path) -> str:
    """Top-level module/package name that *file* belongs to, relative to *root*."""
    return file.relative_to(root).parts[0].removesuffix(".py")


def _imported_top_levels(file: Path, root: Path) -> set[str]:
    """Every top-level module name imported by *file*, at ANY nesting depth.

    ``ast.walk`` is deliberate: a module-level-only scan would call
    apps/intent-engine clean while its function bodies import two local modules.
    """
    try:
        tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
    except (OSError, SyntaxError) as exc:  # pragma: no cover - surfaced as a gate error
        raise RuntimeError(f"cannot parse {file}: {exc}") from exc

    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                # Relative import — always inside this file's own top-level package.
                names.add(_top_level_of(root, file))
            elif node.module:
                names.add(node.module.split(".")[0])
    return names


def _declared_local_sources(root: Path) -> set[str]:
    """Every string argument passed to ``add_local_python_source`` under *root*."""
    declared: set[str] = set()
    for file in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_local_python_source"
            ):
                for arg in node.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        declared.add(arg.value)
    return declared


def _required_local_modules(entrypoint: Path, root: Path) -> dict[str, str]:
    """Local top-level modules reachable from *entrypoint*, mapped to who imports them."""
    required: dict[str, str] = {}
    seen: set[Path] = set()
    queue: list[Path] = [entrypoint]

    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)

        for name in sorted(_imported_top_levels(current, root)):
            target = _local_module_file(root, name)
            if target is None:
                continue  # third-party or stdlib — the image's pip_install owns those
            required.setdefault(name, str(current))
            if target.name == "__init__.py":
                for sibling in sorted(target.parent.rglob("*.py")):
                    if not _is_test_file(sibling):
                        queue.append(sibling)
            elif not _is_test_file(target):
                queue.append(target)

    return required


def check_app(repo_root: Path, entrypoint_rel: str, root_rel: str) -> list[str]:
    """Return a list of violation strings for one app (empty list == pass)."""
    entrypoint = repo_root / entrypoint_rel
    root = repo_root / root_rel
    if not entrypoint.is_file():
        return [f"{entrypoint_rel}: entrypoint does not exist (REGISTRY is stale)"]
    if not root.is_dir():
        return [f"{root_rel}: source root does not exist (REGISTRY is stale)"]

    required = _required_local_modules(entrypoint, root)
    declared = _declared_local_sources(root)

    violations = []
    for name in sorted(required):
        if name not in declared:
            importer = Path(required[name])
            try:
                importer_rel = str(importer.relative_to(repo_root))
            except ValueError:
                importer_rel = str(importer)
            violations.append(
                f"{entrypoint_rel}: local module '{name}' is imported "
                f"(by {importer_rel}) but is NOT in any add_local_python_source(...) "
                f"under {root_rel} — the deployed container will not have it"
            )
    return violations


def check_registry_covers_workflow(repo_root: Path, registry: dict[str, str]) -> list[str]:
    """Every `modal deploy <file>` in modal-deploy.yml must be a REGISTRY entrypoint."""
    workflow = repo_root / DEPLOY_WORKFLOW
    if not workflow.is_file():
        return [f"{DEPLOY_WORKFLOW}: not found — cannot verify REGISTRY coverage"]
    deployed = set(_DEPLOY_RE.findall(workflow.read_text(encoding="utf-8")))
    if not deployed:
        return [
            f"{DEPLOY_WORKFLOW}: no `modal deploy` invocation found — "
            "gate cannot render a verdict"
        ]
    return [
        f"{DEPLOY_WORKFLOW} deploys '{path}' but REGISTRY in this gate does not cover it — "
        "add it (with its sys.path root) so the new app cannot skip this check"
        for path in sorted(deployed - set(registry))
    ]


def run_checks(repo_root: Path, registry: dict[str, str], check_workflow: bool = True) -> int:
    """Run the gate. Returns 0 (pass) or 1 (violations found)."""
    violations: list[str] = []
    for entrypoint_rel, root_rel in registry.items():
        app_violations = check_app(repo_root, entrypoint_rel, root_rel)
        status = "FAIL" if app_violations else "pass"
        print(f"  [{status}] {entrypoint_rel}  (source root: {root_rel})")
        violations.extend(app_violations)

    if check_workflow:
        violations.extend(check_registry_covers_workflow(repo_root, registry))

    if not violations:
        print(
            f"\nPASS: all {len(registry)} deployed Modal app(s) declare "
            "every local module they import."
        )
        return 0

    print("\nFAIL: a deployed Modal app depends on a local module its image never ships.")
    for violation in violations:
        print(f"  - {violation}")
    print(
        "\nFIX: add the module to that app's image, e.g.\n"
        "    image = (modal.Image.debian_slim(...)\n"
        '               .pip_install(...).add_local_python_source("mypkg"))\n'
        "and make sure the module is importable on the deploy runner (PYTHONPATH in\n"
        f"{DEPLOY_WORKFLOW}), because add_local_python_source resolves it with\n"
        "importlib.util.find_spec at deploy time.\n"
        "Context: FOLLOW-900 — `modal deploy` cannot fail on an unimportable image."
    )
    return 1


# ── Self-test (Rule Q) ──────────────────────────────────────────────────────────────────


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def _self_test() -> int:
    """Exercise the real gate against synthetic trees. Returns 0 (ok) or 2 (gate broken)."""
    print("=== Self-test mode ===")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/main.py": "app/src"}

        # CASE 1 — module-level import of an undeclared local module → must FAIL.
        _write(src / "helper.py", "VALUE = 1\n")
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            'image = modal.Image.debian_slim().pip_install("httpx")\n',
        )
        if run_checks(root, registry, check_workflow=False) != 1:
            print("SELF-TEST FAIL: undeclared module-level local import was NOT detected.")
            return 2
        print("OK: undeclared module-level local import detected.\n")

        # CASE 2 — the FOLLOW-900/intent-engine shape: import inside a function body.
        _write(
            src / "main.py",
            "import modal\n"
            'image = modal.Image.debian_slim().pip_install("httpx")\n'
            "def f():\n    from helper import VALUE\n    return VALUE\n",
        )
        if run_checks(root, registry, check_workflow=False) != 1:
            print("SELF-TEST FAIL: undeclared FUNCTION-BODY local import was NOT detected.")
            return 2
        print("OK: undeclared function-body local import detected.\n")

        # CASE 3 — transitive: entrypoint declares 'helper', helper imports undeclared 'deep'.
        _write(src / "deep.py", "DEEP = 2\n")
        _write(src / "helper.py", "from deep import DEEP\nVALUE = DEEP\n")
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("helper")\n',
        )
        if run_checks(root, registry, check_workflow=False) != 1:
            print("SELF-TEST FAIL: undeclared TRANSITIVE local import was NOT detected.")
            return 2
        print("OK: undeclared transitive local import detected.\n")

        # CASE 4 — the healthy shape. Must NOT fire, or the gate is useless noise.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim().pip_install("
            '"httpx").add_local_python_source("helper", "deep")\n',
        )
        if run_checks(root, registry, check_workflow=False) != 0:
            print("SELF-TEST FAIL: a fully declared app was incorrectly flagged.")
            return 2
        print("OK: fully declared app passes.\n")

        # CASE 5 — a deploy the REGISTRY does not cover must FAIL, even with clean apps.
        _write(
            root / DEPLOY_WORKFLOW,
            "run: modal deploy app/src/main.py\nrun: modal deploy app/src/other_app.py\n",
        )
        if run_checks(root, registry, check_workflow=True) != 1:
            print("SELF-TEST FAIL: an entrypoint absent from REGISTRY was NOT detected.")
            return 2
        print("OK: uncovered modal-deploy.yml entrypoint detected.\n")

    print("Self-test PASSED.")
    return 0


def _repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(out.stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        return Path(__file__).resolve().parent.parent


def main(argv: list[str]) -> int:
    if len(argv) > 1 and argv[1] == "--self-test":
        return _self_test()
    if len(argv) > 1:
        print(f"usage: {argv[0]} [--self-test]")
        return 2

    repo_root = _repo_root()
    print("=== Modal local-source gate (FOLLOW-900) ===")
    print(f"Repo root: {repo_root}\n")
    return run_checks(repo_root, REGISTRY)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
