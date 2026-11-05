// Author form only — runtime FormulaSpec is derived client-side at subscription time.

import type { ColorRole } from './colorRole.js';

/** A JSON scalar a rule can write to its target property. */
export type RuleScalar = string | number | boolean | null;

/**
 * A value at a rule position that may also name a theme color: a {@link RuleScalar}
 * or a {@link ColorRole}. Allowed in condition values and the conditional arm's
 * `default`; the formula arm's `default` stays a {@link RuleScalar}.
 */
export type RuleValue = RuleScalar | ColorRole;

/**
 * One PV binding referenced by a rule's conditions.
 *
 * Conditions reference these by 0-based index (`{0}`, `{1}`, …), so renames stay
 * stable. `name` may contain `${MACRO}` substitutions — resolved client-side
 * before subscribing to the Formula Engine.
 */
export interface RulePvBinding {
  readonly name: string;
  /** Whether changes to this PV trigger re-evaluation. Almost always `true`. */
  readonly trigger: boolean;
}

/**
 * One condition in the ordered condition/value list, evaluated top to bottom:
 * the first truthy `expression` wins; if none match, the rule's `default` is used.
 * `expression` references PVs by `{N}` placeholder — e.g. `"{0} > 1"`.
 */
export interface RuleCondition {
  readonly expression: string;
  /** JSON scalar matching the target property's type, or a theme color role. */
  readonly value: RuleValue;
}

/**
 * Fields common to both rule arms.
 *
 * `targetProperty` is any rule-bindable property — a JSON scalar/enum in the
 * widget's `propSchema`, excluding `format: "pv-channel"` fields. Output type
 * must match the property's declared type (checked client-side in the Rule Editor).
 */
interface RuleBase {
  readonly id: string;
  readonly name: string;
  readonly targetProperty: string;
}

/**
 * A widget property rule (author form) — a discriminated union of two arms:
 *
 * - **Conditional** (`conditions`): an ordered condition→value table over `pvs`;
 *   what the `.edl`/`.ui` converter emits. A `pvs[].name` may be a `formula://<name>`
 *   reference, so conditions can test a screen-level formula's output alongside raw PVs.
 * - **Formula-driven** (`formula`): the target property is set directly to the named
 *   screen-level `FormulaDeclaration`'s output — no condition table. `formula` is the
 *   bare formula name, not the `formula://` form.
 *
 * Both arms compile client-side to a Formula Engine `FormulaSpec`; compiled form is never stored.
 */
export type Rule =
  | (RuleBase & {
      /** Value written to the target property when no condition matches. */
      readonly default: RuleValue;
      readonly pvs: readonly RulePvBinding[];
      readonly conditions: readonly RuleCondition[];
    })
  | (RuleBase & {
      /** Value written to the target property before the formula yields one. */
      readonly default: RuleScalar;
      readonly formula: string;
    });
