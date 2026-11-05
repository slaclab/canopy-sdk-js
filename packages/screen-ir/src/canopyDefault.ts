import data from '../data/canopy-default.flat.json' with { type: 'json' };
import type { FlatScheme } from './flatScheme.js';

/**
 * The packaged `canopy-default` scheme, flattened. Generated from the canonical
 * `canopy-default.json` by the pydm `load_scheme` flattener and shipped in `data/`.
 * Consumers use it when no served scheme is available.
 */
export const canopyDefaultFlat: FlatScheme = data;
