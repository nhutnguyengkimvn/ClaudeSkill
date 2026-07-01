"""
Static validator for the Form.io order-services Test Panel → Test Parameters →
aggregator wiring.

Checks (without a browser) that the panel/parameters/copy mechanism is sound so
the live preview will actually produce data:

  order_service_test_panel (select)
      └─ each option value  →  exactly one order_service_test_parameters_<N>
                               (selectboxes) whose customConditional AND
                               validate.custom reference that SAME panel value
      └─ order_service_test_parameters (hidden aggregator) copies the matching
         order_service_test_parameters_<N> via a calculateValue ternary — one arm
         per panel value, pointing at the SAME <N> as the conditional.

Catches the failure modes that silently break panel→parameter wiring:
  - a wrong/typo'd panel value string (option vs. conditional vs. aggregator)
  - a panel with no parameters group, or two groups
  - an aggregator arm missing / pointing at the wrong _<N>
  - an empty parameters values[] list
  - duplicate order_service_test_parameters_<N> keys

Usage:
    python validate_panel_wiring.py <form.json>

Exit code 0 = all checks pass, 1 = one or more failures (details printed).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PANEL_KEY = "order_service_test_panel"
AGG_KEY = "order_service_test_parameters"
PARAM_RE = re.compile(r"^order_service_test_parameters_\d+$")
# panel value referenced inside a JS expression: ... === 'Some Panel'
COND_RE = re.compile(r"order_service_test_panel\s*===\s*'([^']*)'")
# aggregator arm: ... === 'Panel' ? data.order_service_test_parameters_N
ARM_RE = re.compile(
    r"order_service_test_panel\s*===\s*'([^']*)'\s*\?\s*"
    r"data\.(order_service_test_parameters_\d+)"
)


def _walk(node):
    """Yield every component dict anywhere in the schema tree."""
    if isinstance(node, dict):
        if "key" in node and isinstance(node["key"], str):
            yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _first_cond_panel(expr: str) -> str | None:
    m = COND_RE.search(expr or "")
    return m.group(1) if m else None


def validate(schema: dict) -> list[str]:
    """Return a list of error strings; empty means PASS."""
    errors: list[str] = []
    comps = list(_walk(schema))

    panel = next((c for c in comps if c.get("key") == PANEL_KEY), None)
    agg = next((c for c in comps if c.get("key") == AGG_KEY), None)
    params = [c for c in comps if PARAM_RE.match(c.get("key", ""))]

    if panel is None:
        return [f"missing Test Panel select (key={PANEL_KEY})"]
    if agg is None:
        errors.append(f"missing hidden aggregator (key={AGG_KEY})")
    if not params:
        return errors + ["no order_service_test_parameters_<N> groups found"]

    # Panel option values (dedupe-aware)
    panel_values = [
        v.get("value") for v in panel.get("data", {}).get("values", [])
        if v.get("value")
    ]
    if len(panel_values) != len(set(panel_values)):
        errors.append("duplicate values in order_service_test_panel options")

    # Duplicate param keys
    param_keys = [c["key"] for c in params]
    if len(param_keys) != len(set(param_keys)):
        errors.append(f"duplicate parameter keys: {param_keys}")

    # Map panel value -> param key via each group's conditional; validate group
    cond_map: dict[str, str] = {}
    for c in params:
        key = c["key"]
        cp = _first_cond_panel(c.get("customConditional", ""))
        vp = _first_cond_panel(c.get("validate", {}).get("custom", ""))
        if cp is None:
            errors.append(f"{key}: customConditional has no panel reference")
        if vp is None:
            errors.append(f"{key}: validate.custom has no panel reference")
        if cp and vp and cp != vp:
            errors.append(
                f"{key}: customConditional panel '{cp}' != validate.custom panel '{vp}'"
            )
        if cp:
            if cp in cond_map:
                errors.append(
                    f"panel '{cp}' matched by two groups: {cond_map[cp]} and {key}"
                )
            else:
                cond_map[cp] = key
            if cp not in panel_values:
                errors.append(
                    f"{key}: conditional panel '{cp}' is not a Test Panel option value"
                )
        if not c.get("values"):
            errors.append(f"{key}: empty values[] (no parameters to pick)")

    # Every panel option must have exactly one group
    for pv in panel_values:
        if pv not in cond_map:
            errors.append(f"panel option '{pv}' has NO parameters group")

    # Aggregator arms
    if agg is not None:
        arms = dict(ARM_RE.findall(agg.get("calculateValue", "")))
        for pv in panel_values:
            arm_key = arms.get(pv)
            if arm_key is None:
                errors.append(f"aggregator missing arm for panel '{pv}'")
                continue
            if arm_key not in param_keys:
                errors.append(
                    f"aggregator arm for '{pv}' points at unknown key {arm_key}"
                )
            elif cond_map.get(pv) and arm_key != cond_map[pv]:
                errors.append(
                    f"aggregator '{pv}' → {arm_key} but conditional maps it to "
                    f"{cond_map[pv]} (mismatch)"
                )
        for arm_panel in arms:
            if arm_panel not in panel_values:
                errors.append(
                    f"aggregator arm references unknown panel '{arm_panel}'"
                )

    return errors


def _print_summary(schema: dict) -> None:
    comps = list(_walk(schema))
    panel = next((c for c in comps if c.get("key") == PANEL_KEY), None)
    agg = next((c for c in comps if c.get("key") == AGG_KEY), None)
    arms = dict(ARM_RE.findall(agg.get("calculateValue", ""))) if agg else {}
    params = {c["key"]: c for c in comps if PARAM_RE.match(c.get("key", ""))}
    cond_map = {}
    for c in params.values():
        cp = _first_cond_panel(c.get("customConditional", ""))
        if cp:
            cond_map[cp] = c["key"]
    if not panel:
        return
    print(f"\nName: {schema.get('name')}")
    print(f"Panels: {len(panel.get('data', {}).get('values', []))} | "
          f"Param groups: {len(params)} | Aggregator arms: {len(arms)}\n")
    for v in panel.get("data", {}).get("values", []):
        pv = v.get("value")
        grp = cond_map.get(pv, "—")
        arm = arms.get(pv, "—")
        n = len(params.get(grp, {}).get("values", [])) if grp in params else 0
        ok = "✅" if grp != "—" and grp == arm else "❌"
        print(f"  {ok} {pv}\n       group={grp} ({n} opts) | aggregator→{arm}")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python validate_panel_wiring.py <form.json>")
        return 2
    schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(schema)
    _print_summary(schema)
    print()
    if errors:
        print(f"❌ FAIL — {len(errors)} issue(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("✅ PASS — panel → parameters → aggregator wiring is consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
