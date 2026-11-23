// IR widget types and their definitions, as published by slaclab/canopy-spec
// (spec/screen-ir/widgets). The list and the data come from
// widgets.generated.ts, which the spec sync writes.

import { deepFreeze } from './guards.js';
import type { WidgetDefinitionData } from './widget-definition.js';
import { IR_WIDGET_TYPES as GENERATED_TYPES, WIDGET_DEFINITION_DATA } from './widgets.generated.js';

/** Every IR widget `type` the spec defines, sorted. Frozen. */
export const IR_WIDGET_TYPES = deepFreeze(GENERATED_TYPES);

/** An IR widget `type` the spec defines, e.g. `"pv-label"`. */
export type IRWidgetType = (typeof IR_WIDGET_TYPES)[number];

/** One `spec/screen-ir/widgets/<type>.json` file. */
export interface WidgetDefinition extends WidgetDefinitionData {
  /** The IR `type` value; equals the file name. */
  readonly id: IRWidgetType;
}

/**
 * Each IR widget type's definition, keyed by type. Deep-frozen, since every
 * importer shares these objects: copy a definition before changing it.
 */
// The cast only narrows each `id` from string to its key; widgets.test.ts
// checks that every id equals its key.
export const WIDGET_DEFINITIONS = deepFreeze(WIDGET_DEFINITION_DATA) as Readonly<
  Record<IRWidgetType, WidgetDefinition>
>;
