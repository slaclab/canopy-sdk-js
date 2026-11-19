import data from '../data/canopy-default.flat.json' with { type: 'json' };
import type { FlatScheme } from './flatScheme.js';
import { deepFreeze } from './guards.js';

/**
 * The packaged `canopy-default` scheme, flattened. Generated from the canonical
 * `canopy-default.json` by the pydm `load_scheme` flattener and kept in `data/`;
 * the build emits it to `dist/data/`, which is what ships. Consumers use it when
 * no served scheme is available. Deep-frozen, since every
 * importer shares it: copy it before changing it.
 *
 * Experimental: canopy-spec v0.2.0 doesn't define the flat color scheme format
 * or the `canopy-default` palette, so they may change in a minor release until
 * canopy-spec does.
 *
 * @experimental
 */
export const canopyDefaultFlat: FlatScheme = deepFreeze(data);
