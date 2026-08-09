#!/usr/bin/env python3
"""Modal local-source gate: every LOCAL module a deployed Modal app imports must be
declared on that app's image via ``add_local_python_source`` [FOLLOW-900, FOLLOW-903].

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
  3. SHAPE A (FOLLOW-903) — resolve it against the IMPORTING FILE's own directory too. A
     name that resolves ONLY as a sibling is a VIOLATION, not a third-party import:
     ``modal deploy <file>`` puts the entrypoint's directory on ``sys.path`` so the
     registration import succeeds, while the container has only ``/root`` — the import
     dies there, and ``add_local_python_source`` cannot even declare the name because
     ``importlib.util.find_spec`` would not resolve it on the runner either. This is the
     shape ``apps/data-quality`` is one careless edit away from: rewriting
     ``from crons.observability import …`` as ``from observability import …`` re-creates
     FOLLOW-900 in the same file.
  4. Recurse through the local modules transitively (skipping test files). The set of
     files reached is the app's REACHABLE set.
  5. Collect every declaration found in the REACHABLE set — ``add_local_python_source``,
     plus ``add_local_dir`` / ``add_local_file`` of a ``.py`` (SHAPE C, FOLLOW-903: those
     ship source just as well, and ``jobs/_app.py:55,60`` already uses the family). Files
     outside the reachable set and test files do NOT contribute (SHAPE B/B2): a throwaway
     image in an unrelated module, or a declaration inside ``test_*.py``, used to satisfy
     the gate for an entrypoint that never imports either.
  6. Fail if required ⊄ declared.
  7. Fail if ``.github/workflows/modal-deploy.yml`` deploys an entrypoint this REGISTRY
     does not cover — a fourth Modal app cannot quietly opt out of the gate — AND fail if
     a REGISTRY ``root`` disagrees with the ``PYTHONPATH`` that deploy actually uses
     (FOLLOW-903 AC4). A wrong root makes the gate check a different program than the one
     that ships, and the failure then looks exactly like SHAPE A.

WHAT IS *NOT* ASSERTED — see RESIDUALS below (Rule AP)
------------------------------------------------------
The residual list is no longer prose. ``RESIDUALS`` is a register this gate PRINTS on
every run, and the self-test asserts that every entry is either exercised by a named
self-test case (with its expected verdict written down, including the ones that
deliberately pass) or backed by an artefact that must exist on disk. A hole a future
reader can execute is a disclosure; a hole in a docstring is a hope.

SELF-TEST (Rule Q / Rule AE — this gate has observed its own failure)
---------------------------------------------------------------------
``python3 scripts/check-modal-local-imports.py --self-test`` builds synthetic app trees
and runs the REAL ``run_checks`` against them. Cases cover the four shapes FOLLOW-900's
own defect used AND the shapes it did not (Rule AE: "a fix that closes the one shape a
regression happened to use is not proof the class is closed") — sibling-only imports,
out-of-reach declarations, test-file declarations, the ``add_local_dir`` family, package
over-approximation, dynamic imports, and REGISTRY/workflow disagreement. CI runs the
self-test before the real check, so a broken detector cannot pass the gate.

EXIT CODES
  0  every deployed Modal app declares every local module it imports
  1  violation: an app imports a local module its image does not declare, an app imports a
     sibling-only module the container will not have, or REGISTRY disagrees with
     modal-deploy.yml
  2  the gate itself is broken (self-test failure) or was misused (usage error)
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# ── Registry ────────────────────────────────────────────────────────────────────────────
# entrypoint (as passed to `modal deploy`) → source root that is on sys.path at deploy time.
# The roots are not cosmetic: `modal deploy <file>` puts the FILE's directory on sys.path,
# which is why modal-deploy.yml sets PYTHONPATH=apps/data-quality/src explicitly — the
# entrypoint lives one level deeper than its package root. Resolution here must mirror the
# path the deploy actually uses, or the gate checks a different program than the one that
# ships. That mirroring is no longer trust-based: `check_registry_matches_workflow` derives
# each root from modal-deploy.yml's own PYTHONPATH (falling back to the entrypoint's
# directory, which is what modal does when PYTHONPATH is unset) and fails on disagreement.
REGISTRY: dict[str, str] = {
    "apps/llm-gateway/src/main.py": "apps/llm-gateway/src",
    "apps/intent-engine/src/main.py": "apps/intent-engine/src",
    "apps/data-quality/src/crons/schema_validation.py": "apps/data-quality/src",
}

DEPLOY_WORKFLOW = ".github/workflows/modal-deploy.yml"

# ── The EFFECT-axis complement, and what "it is in place" means (FOLLOW-919) ─────────────
# R-F1 originally asserted `Path("scripts/check-modal-container-effect.py").exists()`.
# Measured: probe DELETED -> caught; probe TRUNCATED TO ZERO BYTES -> "OK [R-F1] covered",
# exit 0. Deletion is the shape nobody performs; un-wiring is the shape that happens —
# removing the three invocation sites leaves the file on disk and this register green while
# the estate's only effect axis for two of three Modal apps is gone.
EFFECT_PROBE = "scripts/check-modal-container-effect.py"
# Every workflow step that CLAIMS to run the probe, with the app selector it must carry.
# Parsed, never imported or executed: the whole value of R-F1 is that the description-axis
# and effect-axis controls are INDEPENDENT (FOLLOW-919 AC(4)).
EFFECT_PROBE_CALLERS: tuple[tuple[str, str], ...] = (
    (".github/workflows/modal-deploy.yml", "--app llm-gateway"),
    (".github/workflows/modal-deploy.yml", "--app intent-engine"),
    (".github/workflows/cron-heartbeat.yml", "--app all"),
)


def _invokes_effect_probe(text: str, selector: str) -> bool:
    """True if an un-commented `run:` step invokes the probe with *selector*.

    A comment mentioning the probe, and the `paths:` filter entry that merely names the
    file, must not count — the same discipline case W2 already applies to `modal deploy`.
    """
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if "run:" in line and EFFECT_PROBE in line and selector in line:
            return True
    return False


def _effect_probe_wiring(repo_root: Path) -> list[str]:
    """Problems with the effect-axis control being IN PLACE. Empty list == satisfied."""
    probe = repo_root / EFFECT_PROBE
    if not probe.is_file():
        return [f"{EFFECT_PROBE} does not exist"]
    text = probe.read_text(encoding="utf-8", errors="replace")
    problems: list[str] = []
    if "--app" not in text:
        problems.append(
            f"{EFFECT_PROBE} exists ({len(text)} bytes) but does not declare the `--app` "
            "selector every caller passes it — a truncated or gutted probe is not a control"
        )
    for workflow, selector in EFFECT_PROBE_CALLERS:
        path = repo_root / workflow
        if not path.is_file():
            problems.append(f"{workflow}: not found — cannot verify it still invokes {EFFECT_PROBE}")
            continue
        if not _invokes_effect_probe(path.read_text(encoding="utf-8"), selector):
            problems.append(
                f"{workflow}: no un-commented `run:` step invokes {EFFECT_PROBE} with "
                f"'{selector}' — the file may still be on disk, but nothing runs it"
            )
    return problems

_DEPLOY_RE = re.compile(r"modal\s+deploy\s+(\S+\.py)")
_STEP_RE = re.compile(r"^-\s+(name|uses|id)\s*:")
_PYTHONPATH_RE = re.compile(r"^PYTHONPATH\s*:\s*(\S+)")

# Declaration APIs that put local source into the image.
_SOURCE_DECL = "add_local_python_source"
_DIR_DECL = "add_local_dir"
_FILE_DECL = "add_local_file"
# Sentinel: a declaration that lands local source directly on sys.path root (`/root`),
# i.e. everything under it is shipped and nothing can be undeclared.
_DECLARES_EVERYTHING = "*"


# ── Residual register (Rule AP — machine-checked, printed, self-test-covered) ────────────
@dataclass(frozen=True)
class ExternalControl:
    """A residual whose closure lives in a DIFFERENT control, asserted as a PROPERTY.

    ``describe`` states the property in words; ``probe`` asserts it and returns the
    problems found (empty == satisfied).

    A PATH is deliberately not accepted here. R-F1 shipped as
    ``artifact="scripts/check-modal-container-effect.py"``, i.e. ``.exists()`` — and a
    probe truncated to zero bytes, or one whose every invocation site had been deleted,
    left this register printing "OK [R-F1] covered" while the estate's only effect axis
    for two of three Modal apps was gone (FOLLOW-919). An artefact-kind residual asserts
    that a control IS IN PLACE, and a filename is not evidence of that.
    """

    describe: str
    probe: Callable[[Path], list[str]]


@dataclass(frozen=True)
class Residual:
    """One thing this gate does NOT assert, with the proof that the hole is real.

    Exactly one of ``self_test_case`` / ``external_control`` must be set:
      * ``self_test_case`` — a case id in ``_self_test`` that executes the shape and
        asserts its verdict (including ``exit 0`` for a deliberately open hole).
      * ``external_control`` — for a residual whose closure lives in a different control
        rather than in a code path this gate can exercise.
    """

    rid: str
    title: str
    verdict: str
    self_test_case: str | None = None
    external_control: ExternalControl | None = None


RESIDUALS: tuple[Residual, ...] = (
    Residual(
        rid="R-B1",
        title=(
            "Declarations are scoped to the app's REACHABLE file set, not to the image "
            "object attached to the @app.function decorators reachable from the "
            "entrypoint. Two images built in the same reachable set are indistinguishable, "
            "so a declaration on image X satisfies a function that runs on image Y. "
            "Per-image resolution needs cross-module value tracking (llm-gateway's "
            "functions take `image=_image` imported from jobs/_app.py) and was judged too "
            "fragile to do statically — FOLLOW-903 AC(2) second branch."
        ),
        verdict="exit 0 — documented hole, executed by case B3",
        self_test_case="B3",
    ),
    Residual(
        rid="R-C1",
        title=(
            "add_local_dir / add_local_file satisfy a declaration by NAME only. The gate "
            "does not verify that the remote path actually lands on the container's "
            "sys.path — `.add_local_dir('nlp', '/opt/nlp')` counts as declaring `nlp` "
            "although /opt is not importable. Over-permissive by choice: SHAPE C used to "
            "be a FALSE RED with an inverted diagnosis, and a false green here still "
            "requires someone to have written an explicit declaration."
        ),
        verdict="exit 0 — documented hole, executed by case C-OFFPATH",
        self_test_case="C-OFFPATH",
    ),
    Residual(
        rid="R-D1",
        title=(
            "The import walk (`_walk_app`) over-approximates in the SAFE direction: on a "
            "package "
            "__init__.py it queues every *.py under that package via rglob rather than the "
            "reachable set, so an import in a module nothing actually imports still counts "
            "as required. That inflates the required set (possible FALSE RED) and is a "
            "deliberate tradeoff — under-approximating is how FOLLOW-900 shipped."
        ),
        verdict="exit 1 — deliberate over-approximation, executed by case D1",
        self_test_case="D1",
    ),
    Residual(
        rid="R-E1",
        title=(
            "Dynamic imports are invisible: importlib.import_module on a computed name, "
            "__import__, or sys.path manipulation at runtime. Verified absent from all "
            "three deployed roots at FOLLOW-903 time (only test files match)."
        ),
        verdict="exit 0 — documented hole, executed by case E1",
        self_test_case="E1",
    ),
    Residual(
        rid="R-F1",
        title=(
            "THE AXIS THIS GATE IS NOT ON. This is static analysis of source text: it "
            "never starts a container and cannot prove one reaches line 1 of its own "
            "logic. It is a DESCRIPTION-axis control (RETRO-262). The EFFECT-axis "
            "complement is scripts/check-modal-container-effect.py (FOLLOW-904), which "
            "invokes the deployed functions and asserts an observable effect; this gate "
            "passing while every container dies is possible and that is the whole point "
            "of shipping both."
        ),
        verdict="not executable here — the complementary control must be WIRED, not merely present",
        external_control=ExternalControl(
            describe=(
                f"{EFFECT_PROBE} is invoked by every workflow that claims to run it "
                f"({len(EFFECT_PROBE_CALLERS)} sites) and still declares the `--app` selector"
            ),
            probe=_effect_probe_wiring,
        ),
    ),
)


def _is_test_file(path: Path) -> bool:
    """Test/fixture modules are not shipped to Modal, so their imports are out of scope."""
    return "test" in path.name or path.name == "conftest.py"


def _local_module_file(directory: Path, name: str) -> Path | None:
    """Return the file that ``name`` resolves to under *directory*, or None if not there."""
    pkg_init = directory / name / "__init__.py"
    if pkg_init.is_file():
        return pkg_init
    module = directory / f"{name}.py"
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


def _positional_strings(node: ast.Call) -> list[str]:
    """Positional arguments of *node* that are string literals, in order."""
    return [a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]


def _kwarg_string(node: ast.Call, name: str) -> str | None:
    """Value of keyword argument *name* when it is a string literal."""
    for kw in node.keywords:
        if kw.arg == name and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
            return kw.value.value
    return None


def _names_from_dir_decl(node: ast.Call) -> set[str]:
    """Module names an ``add_local_dir`` call makes available (SHAPE C)."""
    args = _positional_strings(node)
    remote = args[1] if len(args) > 1 else _kwarg_string(node, "remote_path")
    local = args[0] if args else _kwarg_string(node, "local_path")
    target = remote or local
    if not target:
        return set()
    norm = target.rstrip("/") or "/"
    if norm in ("/", "/root"):
        # The whole directory is dropped onto the container's sys.path root.
        return {_DECLARES_EVERYTHING}
    name = PurePosixPath(norm).name
    return {name} if name else set()


def _names_from_file_decl(node: ast.Call) -> set[str]:
    """Module name an ``add_local_file`` call makes available, when it ships a .py."""
    args = _positional_strings(node)
    remote = args[1] if len(args) > 1 else _kwarg_string(node, "remote_path")
    local = args[0] if args else _kwarg_string(node, "local_path")
    target = remote or local
    if not target or not target.endswith(".py"):
        return set()  # contract JSON / data files ship no importable module
    return {PurePosixPath(target).stem}


def _declared_local_sources(files: set[Path]) -> dict[str, set[str]]:
    """Declared module names → the files that declare them, harvested from *files* only.

    SHAPE B/B2 (FOLLOW-903): the previous implementation rglob'd the whole source root and
    unioned every declaration it found, so an unrelated module's throwaway image — or a
    ``test_*.py`` — satisfied the gate for an entrypoint that imports neither. Only the
    files actually reachable from the entrypoint contribute now.
    """
    declared: dict[str, set[str]] = {}
    for file in sorted(files):
        if _is_test_file(file):
            continue
        try:
            tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            attr = node.func.attr
            if attr == _SOURCE_DECL:
                names = set(_positional_strings(node))
            elif attr == _DIR_DECL:
                names = _names_from_dir_decl(node)
            elif attr == _FILE_DECL:
                names = _names_from_file_decl(node)
            else:
                continue
            for name in names:
                declared.setdefault(name, set()).add(str(file))
    return declared


@dataclass
class Walk:
    """Result of walking an app's import graph from its entrypoint."""

    required: dict[str, str]  # local top-level name → file that imports it
    reachable: set[Path]  # every file the walk visited (the declaration scope)
    siblings: list[tuple[str, Path, Path]]  # (name, importing file, sibling file)


def _walk_app(entrypoint: Path, root: Path) -> Walk:
    """Local top-level modules reachable from *entrypoint*, plus SHAPE A findings."""
    required: dict[str, str] = {}
    siblings: list[tuple[str, Path, Path]] = []
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
                # SHAPE A — not at the root, but sitting right next to the importer.
                # `modal deploy <file>` puts the importer's own directory on sys.path at
                # registration time, so this import RESOLVES on the runner and DIES in the
                # container, where only /root is importable.
                if current.parent.resolve() != root.resolve():
                    sibling = _local_module_file(current.parent, name)
                    if sibling is not None:
                        siblings.append((name, current, sibling))
                continue  # otherwise third-party or stdlib — the image's pip_install owns it
            required.setdefault(name, str(current))
            if target.name == "__init__.py":
                for sibling_file in sorted(target.parent.rglob("*.py")):
                    if not _is_test_file(sibling_file):
                        queue.append(sibling_file)
            elif not _is_test_file(target):
                queue.append(target)

    return Walk(required=required, reachable=seen, siblings=siblings)


def _rel(repo_root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def check_app(repo_root: Path, entrypoint_rel: str, root_rel: str) -> list[str]:
    """Return a list of violation strings for one app (empty list == pass)."""
    entrypoint = repo_root / entrypoint_rel
    root = repo_root / root_rel
    if not entrypoint.is_file():
        return [f"{entrypoint_rel}: entrypoint does not exist (REGISTRY is stale)"]
    if not root.is_dir():
        return [f"{root_rel}: source root does not exist (REGISTRY is stale)"]

    walk = _walk_app(entrypoint, root)
    declared = _declared_local_sources(walk.reachable)

    violations = []

    for name, importer, sibling in walk.siblings:
        package = _top_level_of(root, importer)
        violations.append(
            f"{entrypoint_rel}: SHAPE A — '{name}' is imported by "
            f"{_rel(repo_root, importer)} and resolves ONLY as a sibling "
            f"({_rel(repo_root, sibling)}), not from the source root {root_rel}. "
            f"`modal deploy` puts the importing file's own directory on sys.path so "
            f"registration succeeds; the container has only /root, so this import dies "
            f"there. add_local_python_source('{name}') cannot fix it — find_spec would "
            f"not resolve the name on the runner either. Import it through its package: "
            f"`from {package}.{name} import ...`"
        )

    if _DECLARES_EVERYTHING not in declared:
        for name in sorted(walk.required):
            if name not in declared:
                importer_rel = _rel(repo_root, Path(walk.required[name]))
                violations.append(
                    f"{entrypoint_rel}: local module '{name}' is imported "
                    f"(by {importer_rel}) but is NOT declared by any "
                    f"add_local_python_source / add_local_dir / add_local_file call in "
                    f"the files reachable from this entrypoint under {root_rel} — "
                    "the deployed container will not have it"
                )
    return violations


def _workflow_deploy_map(text: str) -> dict[str, str]:
    """Map every `modal deploy <file>` in the workflow to the root it deploys with.

    The root is the step's ``PYTHONPATH`` when set, else the entrypoint's own directory —
    which is exactly what ``modal deploy <file>`` puts on sys.path. Comment lines are
    skipped: the workflow header documents a MANUAL FALLBACK containing real
    `PYTHONPATH=... modal deploy ...` command lines, and parsing those as deploy steps
    would let a stale comment dictate the gate's verdict.
    """
    found: dict[str, str] = {}
    pythonpath: str | None = None
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("#"):
            continue
        if _STEP_RE.match(stripped):
            pythonpath = None  # new step — the previous step's env does not carry over
        match = _PYTHONPATH_RE.match(stripped)
        if match:
            pythonpath = match.group(1).strip("\"'")
        for path in _DEPLOY_RE.findall(stripped):
            found[path] = pythonpath or str(PurePosixPath(path).parent)
    return found


def check_registry_matches_workflow(repo_root: Path, registry: dict[str, str]) -> list[str]:
    """REGISTRY must cover every `modal deploy` in modal-deploy.yml, with the SAME root."""
    workflow = repo_root / DEPLOY_WORKFLOW
    if not workflow.is_file():
        return [f"{DEPLOY_WORKFLOW}: not found — cannot verify REGISTRY coverage"]
    deployed = _workflow_deploy_map(workflow.read_text(encoding="utf-8"))
    if not deployed:
        return [
            f"{DEPLOY_WORKFLOW}: no `modal deploy` invocation found — "
            "gate cannot render a verdict"
        ]

    violations: list[str] = []
    for path in sorted(deployed):
        if path not in registry:
            violations.append(
                f"{DEPLOY_WORKFLOW} deploys '{path}' but REGISTRY in this gate does not "
                "cover it — add it (with its sys.path root) so the new app cannot skip "
                "this check"
            )
        elif registry[path] != deployed[path]:
            violations.append(
                f"{DEPLOY_WORKFLOW} deploys '{path}' with sys.path root "
                f"'{deployed[path]}' but REGISTRY says '{registry[path]}' — the gate "
                "would check a different program than the one that ships, and the "
                "resulting miss looks exactly like SHAPE A (FOLLOW-903 AC4)"
            )
    for path in sorted(set(registry) - set(deployed)):
        violations.append(
            f"REGISTRY covers '{path}' but {DEPLOY_WORKFLOW} does not deploy it — "
            "either the workflow lost a deploy step or REGISTRY is stale; both are "
            "states where an app ships unchecked"
        )
    return violations


def print_residuals() -> None:
    """Print the machine-checked residual register (Rule AP)."""
    print(f"\nRESIDUALS — what this gate does NOT assert ({len(RESIDUALS)} entries):")
    for residual in RESIDUALS:
        covered = (
            f"self-test case {residual.self_test_case}"
            if residual.self_test_case
            else f"external control — {residual.external_control.describe}"
        )
        print(f"  [{residual.rid}] {residual.verdict}  ({covered})")
        print(f"        {residual.title}")


def run_checks(repo_root: Path, registry: dict[str, str], check_workflow: bool = True) -> int:
    """Run the gate. Returns 0 (pass) or 1 (violations found)."""
    violations: list[str] = []
    for entrypoint_rel, root_rel in registry.items():
        app_violations = check_app(repo_root, entrypoint_rel, root_rel)
        status = "FAIL" if app_violations else "pass"
        print(f"  [{status}] {entrypoint_rel}  (source root: {root_rel})")
        violations.extend(app_violations)

    if check_workflow:
        violations.extend(check_registry_matches_workflow(repo_root, registry))

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


# ── Self-test (Rule Q + Rule AE) ────────────────────────────────────────────────────────


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


class _Cases:
    """Records which self-test case ids actually executed, for residual coverage."""

    def __init__(self) -> None:
        self.executed: list[str] = []
        self.failed = False

    def expect(self, case_id: str, what: str, actual: int, expected: int) -> None:
        self.executed.append(case_id)
        if actual != expected:
            print(f"SELF-TEST FAIL [{case_id}]: {what} — expected exit {expected}, got {actual}")
            self.failed = True
        else:
            print(f"OK [{case_id}] exit {expected}: {what}\n")


def _self_test() -> int:  # noqa: PLR0915 - one linear script of cases, deliberately flat
    """Exercise the real gate against synthetic trees. Returns 0 (ok) or 2 (gate broken)."""
    print("=== Self-test mode ===")
    cases = _Cases()
    modal_image = 'image = modal.Image.debian_slim().pip_install("httpx")\n'

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/main.py": "app/src"}

        # ── The four shapes FOLLOW-900's own defect used ────────────────────────────────
        # CASE 1 — module-level import of an undeclared local module → must FAIL.
        _write(src / "helper.py", "VALUE = 1\n")
        _write(src / "main.py", "import modal\nfrom helper import VALUE\n" + modal_image)
        cases.expect(
            "1",
            "undeclared module-level local import",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE 2 — the FOLLOW-900/intent-engine shape: import inside a function body.
        _write(
            src / "main.py",
            "import modal\n" + modal_image + "def f():\n    from helper import VALUE\n    return VALUE\n",
        )
        cases.expect(
            "2",
            "undeclared FUNCTION-BODY local import",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE 3 — transitive: entrypoint declares 'helper', helper imports undeclared 'deep'.
        _write(src / "deep.py", "DEEP = 2\n")
        _write(src / "helper.py", "from deep import DEEP\nVALUE = DEEP\n")
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("helper")\n',
        )
        cases.expect(
            "3",
            "undeclared TRANSITIVE local import",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE 4 — the healthy shape. Must NOT fire, or the gate is useless noise.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim().pip_install("
            '"httpx").add_local_python_source("helper", "deep")\n',
        )
        cases.expect(
            "4", "fully declared app", run_checks(root, registry, check_workflow=False), 0
        )

        # CASE 5 — a deploy the REGISTRY does not cover must FAIL, even with clean apps.
        _write(
            root / DEPLOY_WORKFLOW,
            "    - name: a\n      run: modal deploy app/src/main.py\n"
            "    - name: b\n      run: modal deploy app/src/other_app.py\n",
        )
        cases.expect(
            "5",
            "entrypoint deployed by the workflow but absent from REGISTRY",
            run_checks(root, registry, check_workflow=True),
            1,
        )

    # ── FOLLOW-903 / Rule AE: shapes the original defect did NOT use ────────────────────
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/crons/entry.py": "app/src"}

        # CASE A1 — SHAPE A. Nested entrypoint, bare sibling import. This is
        # apps/data-quality's exact layout and the gate used to return 0.
        _write(src / "crons" / "__init__.py", "")
        _write(src / "crons" / "observability.py", "def init_sentry():\n    pass\n")
        _write(
            src / "crons" / "entry.py",
            "import modal\nfrom observability import init_sentry\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("crons")\n',
        )
        cases.expect(
            "A1",
            "SHAPE A sibling-only import from a NESTED entrypoint",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE A2 — same shape one hop deeper: a sibling-only import inside a transitively
        # imported module, where the entrypoint itself is clean.
        _write(
            src / "crons" / "entry.py",
            "import modal\nfrom crons.worker import run\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("crons")\n',
        )
        _write(src / "crons" / "worker.py", "from observability import init_sentry\n\nrun = 1\n")
        cases.expect(
            "A2",
            "SHAPE A sibling-only import inside a TRANSITIVE module",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE A3 — the package-qualified form of the same import must stay silent, or the
        # fix for SHAPE A would red-flag apps/data-quality as it actually ships today.
        _write(src / "crons" / "worker.py", "from crons.observability import init_sentry\n\nrun = 1\n")
        cases.expect(
            "A3",
            "package-qualified sibling import (the correct form)",
            run_checks(root, registry, check_workflow=False),
            0,
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/main.py": "app/src"}
        _write(src / "helper.py", "VALUE = 1\n")
        entry_undeclared = "import modal\nfrom helper import VALUE\n" + modal_image

        # CASE B1 — SHAPE B. The only declaration lives in a module the entrypoint never
        # imports. It used to satisfy the gate because the harvest rglob'd the whole root.
        _write(src / "main.py", entry_undeclared)
        _write(
            src / "unrelated.py",
            "import modal\n"
            'throwaway = modal.Image.debian_slim().add_local_python_source("helper")\n',
        )
        cases.expect(
            "B1",
            "SHAPE B declaration in an UNREACHABLE module",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE B2 — SHAPE B2. Declaration inside a test file. Test files are never shipped.
        (src / "unrelated.py").unlink()
        _write(
            src / "test_images.py",
            "import modal\n"
            'fixture = modal.Image.debian_slim().add_local_python_source("helper")\n',
        )
        cases.expect(
            "B2",
            "SHAPE B2 declaration inside a test_*.py",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE B3 — RESIDUAL R-B1, deliberately OPEN and asserted as exit 0 so the hole is
        # executable rather than invisible. The declaration is on a DIFFERENT image object
        # than the one the entrypoint's function uses, but both live in reachable files.
        (src / "test_images.py").unlink()
        _write(
            src / "main.py",
            "import modal\nfrom other import OTHER\nfrom helper import VALUE\n"
            'image = modal.Image.debian_slim().pip_install("httpx")\n'
            "@modal.App().function(image=image)\ndef f():\n    return VALUE\n",
        )
        _write(
            src / "other.py",
            "import modal\n"
            'second_image = modal.Image.debian_slim().add_local_python_source("helper", "other")\n'
            "OTHER = 1\n",
        )
        cases.expect(
            "B3",
            "R-B1 OPEN: declaration on a different image object in a reachable file",
            run_checks(root, registry, check_workflow=False),
            0,
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/main.py": "app/src"}
        _write(src / "helper.py", "VALUE = 1\n")

        # CASE C-DIR — SHAPE C. add_local_dir onto the container's sys.path used to be a
        # FALSE RED with an inverted diagnosis ("the container will not have it").
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_dir("src/helper", "/root/helper")\n',
        )
        cases.expect(
            "C-DIR", "SHAPE C add_local_dir declares the module",
            run_checks(root, registry, check_workflow=False), 0,
        )

        # CASE C-FILE — add_local_file of a .py ships an importable module.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_file("src/helper.py", "/root/helper.py")\n',
        )
        cases.expect(
            "C-FILE", "SHAPE C add_local_file of a .py declares the module",
            run_checks(root, registry, check_workflow=False), 0,
        )

        # CASE C-ROOT — a directory dropped straight onto /root declares everything in it.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_dir("src", remote_path="/root")\n',
        )
        cases.expect(
            "C-ROOT", "SHAPE C add_local_dir onto /root declares everything",
            run_checks(root, registry, check_workflow=False), 0,
        )

        # CASE C-JSON — add_local_file of a NON-.py (llm-gateway's contract fixtures) must
        # NOT be read as declaring a module, or the gate would go quietly blind.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_file("c.json", "/packages/c.json")\n',
        )
        cases.expect(
            "C-JSON", "add_local_file of a .json declares nothing",
            run_checks(root, registry, check_workflow=False), 1,
        )

        # CASE C-OFFPATH — RESIDUAL R-C1, deliberately OPEN: the remote path is not on the
        # container's sys.path, yet the name counts as declared.
        _write(
            src / "main.py",
            "import modal\nfrom helper import VALUE\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_dir("src/helper", "/opt/helper")\n',
        )
        cases.expect(
            "C-OFFPATH", "R-C1 OPEN: add_local_dir to a path that is not importable",
            run_checks(root, registry, check_workflow=False), 0,
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        registry = {"app/src/main.py": "app/src"}

        # CASE D1 — RESIDUAL R-D1, deliberately OPEN in the FALSE-RED direction: importing
        # a package pulls in every module under it, including ones nothing imports.
        _write(src / "pkg" / "__init__.py", "")
        _write(src / "pkg" / "used.py", "USED = 1\n")
        _write(src / "pkg" / "never_imported.py", "from lonely import X\n")
        _write(src / "lonely.py", "X = 1\n")
        _write(
            src / "main.py",
            "import modal\nfrom pkg.used import USED\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("pkg")\n',
        )
        cases.expect(
            "D1",
            "R-D1 OPEN: package rglob over-approximates the required set (false red)",
            run_checks(root, registry, check_workflow=False),
            1,
        )

        # CASE E1 — RESIDUAL R-E1, deliberately OPEN: a computed dynamic import.
        _write(src / "pkg" / "never_imported.py", "USED = 2\n")
        _write(
            src / "main.py",
            "import importlib\nimport modal\nfrom pkg.used import USED\n"
            "image = modal.Image.debian_slim()"
            '.pip_install("httpx").add_local_python_source("pkg")\n'
            'def f():\n    return importlib.import_module("lonely")\n',
        )
        cases.expect(
            "E1",
            "R-E1 OPEN: importlib.import_module on a computed name is invisible",
            run_checks(root, registry, check_workflow=False),
            0,
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / "app" / "src"
        _write(src / "crons" / "__init__.py", "")
        _write(src / "crons" / "entry.py", "import modal\n" + modal_image)

        # CASE W1 — a REGISTRY root that disagrees with the workflow's PYTHONPATH. The gate
        # would otherwise check a different program than the one that ships.
        _write(
            root / DEPLOY_WORKFLOW,
            "    - name: Deploy\n      env:\n        PYTHONPATH: app/src\n"
            "      run: modal deploy app/src/crons/entry.py\n",
        )
        cases.expect(
            "W1",
            "REGISTRY root disagrees with modal-deploy.yml PYTHONPATH",
            run_checks(root, {"app/src/crons/entry.py": "app/src/crons"}, check_workflow=True),
            1,
        )

        # CASE W2 — the same roots agreeing, with a MANUAL FALLBACK comment line that also
        # contains a `modal deploy` command. A comment must not drive the verdict.
        _write(
            root / DEPLOY_WORKFLOW,
            "#   PYTHONPATH=wrong/root modal deploy app/src/crons/other.py\n"
            "    - name: Deploy\n      env:\n        PYTHONPATH: app/src\n"
            "      run: modal deploy app/src/crons/entry.py\n",
        )
        cases.expect(
            "W2",
            "a `modal deploy` inside a COMMENT is not a deploy step",
            run_checks(root, {"app/src/crons/entry.py": "app/src"}, check_workflow=True),
            0,
        )

        # CASE W3 — REGISTRY carries an entrypoint the workflow no longer deploys.
        cases.expect(
            "W3",
            "REGISTRY entry the workflow does not deploy (stale registry)",
            run_checks(
                root,
                {"app/src/crons/entry.py": "app/src", "app/src/crons/gone.py": "app/src"},
                check_workflow=True,
            ),
            1,
        )

    # ── FOLLOW-919: R-F1 asserts WIRING, not a filename ────────────────────────────────
    # Every case below returned "OK [R-F1] covered" under the previous `.exists()`
    # predicate. F1-TRUNCATED is the exact perturbation RETRO-263 measured: the probe cut
    # to zero bytes while the register stayed green.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        def _wire(probe_body: str, *, drop: tuple[str, str] | None = None,
                  comment_only: tuple[str, str] | None = None) -> None:
            """Build a repo where the probe is wired, minus whatever is dropped."""
            _write(root / EFFECT_PROBE, probe_body)
            steps: dict[str, list[str]] = {w: [] for w, _ in EFFECT_PROBE_CALLERS}
            for caller in EFFECT_PROBE_CALLERS:
                workflow, selector = caller
                if caller == drop:
                    continue
                prefix = "# " if caller == comment_only else ""
                steps[workflow].append(
                    f"      - name: effect probe\n"
                    f"        {prefix}run: python3 {EFFECT_PROBE} {selector} --attempts 3\n"
                )
            for workflow, lines in steps.items():
                _write(root / workflow, "".join(lines) or "      - name: unrelated\n        run: true\n")

        probe = "parser.add_argument('--app', choices=('intent-engine', 'llm-gateway', 'all'))\n"

        _wire(probe)
        cases.expect(
            "F1-OK",
            "R-F1: a fully wired effect probe satisfies the external control",
            1 if _effect_probe_wiring(root) else 0,
            0,
        )

        _wire(probe, drop=EFFECT_PROBE_CALLERS[2])
        cases.expect(
            "F1-UNWIRED",
            "R-F1: probe on disk but cron-heartbeat no longer invokes it",
            1 if _effect_probe_wiring(root) else 0,
            1,
        )

        _wire("")
        cases.expect(
            "F1-TRUNCATED",
            "R-F1: probe truncated to zero bytes (was 'OK [R-F1] covered', exit 0)",
            1 if _effect_probe_wiring(root) else 0,
            1,
        )

        _wire(probe, comment_only=EFFECT_PROBE_CALLERS[0])
        cases.expect(
            "F1-COMMENT",
            "R-F1: an invocation that survives only inside a COMMENT is not an invocation",
            1 if _effect_probe_wiring(root) else 0,
            1,
        )

    # ── Rule AP: every residual must be executable or artefact-backed ───────────────────
    print("=== Residual coverage (Rule AP) ===")
    executed = set(cases.executed)
    repo_root = _repo_root()
    for residual in RESIDUALS:
        if bool(residual.self_test_case) == bool(residual.external_control):
            print(f"SELF-TEST FAIL: residual {residual.rid} must set exactly one of "
                  "self_test_case / external_control")
            cases.failed = True
        elif residual.self_test_case and residual.self_test_case not in executed:
            print(f"SELF-TEST FAIL: residual {residual.rid} names self-test case "
                  f"'{residual.self_test_case}', which did not execute")
            cases.failed = True
        elif residual.external_control:
            problems = residual.external_control.probe(repo_root)
            if problems:
                print(f"SELF-TEST FAIL: residual {residual.rid}'s external control is not in "
                      f"place — {residual.external_control.describe}")
                for problem in problems:
                    print(f"    - {problem}")
                cases.failed = True
            else:
                print(f"OK [{residual.rid}] covered")
        else:
            print(f"OK [{residual.rid}] covered")

    if cases.failed:
        print("\nSelf-test FAILED — the gate is broken. Exit 2.")
        return 2
    print(f"\nSelf-test PASSED ({len(cases.executed)} cases, {len(RESIDUALS)} residuals).")
    print_residuals()
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
    print("=== Modal local-source gate (FOLLOW-900, hardened by FOLLOW-903) ===")
    print(f"Repo root: {repo_root}\n")
    code = run_checks(repo_root, REGISTRY)
    print_residuals()
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
