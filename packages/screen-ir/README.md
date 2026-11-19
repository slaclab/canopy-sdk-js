# @slaclab/canopy-screen-ir

The Screen IR contract for TypeScript. The Screen IR (_intermediate
representation_) is the `*.screen.json` format: the PyDM/EDM converter writes
it, the screen builder edits it, and the runtime renders it. This package holds
the JSON Schema, the widget type definitions, TypeScript model types, and
`validate()`. It doesn't render anything and needs no framework; its only
dependency is `ajv`.

The schema and widget definitions are not written here. They are copied from
[slaclab/canopy-spec](https://github.com/slaclab/canopy-spec), pinned to the
release tag in `spec.lock.json`. See [Updating the spec](#updating-the-spec).

## Validation

```ts
import { validate, validateDetailed } from '@slaclab/canopy-screen-ir';

validate(doc); // string[]; empty means valid
validateDetailed(doc); // { rule, instancePath, message }[]
```

`validate()` checks the JSON Schema first, then the semantic rules the schema
can't express. Those rules are defined in the canopy-spec README:

| `rule`                    | Fails when                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `schema`                  | The document doesn't match the JSON Schema                         |
| `macro-default-required`  | A screen's macro has no `default`                                  |
| `macro-default-forbidden` | A template's macro declares a `default`                            |
| `formula-ref-unresolved`  | A `formula://` reference has no matching `formulas[]` entry        |
| `color-role-version`      | A `"1.0"` document carries a color role in a prop or rule position |

`instancePath` is a JSON Pointer to the failing location. The package passes
canopy-spec's conformance cases at level 2: valid vs invalid, plus each error's
rule and location.

## Exports

- `validate`, `validateDetailed`, `ValidationError`, `ValidationRule`
- `SCHEMA_VERSION`, and the model types (`ScreenJSON`, `WidgetNode`, `Rule`, …)
- `MACRO_NAME_PATTERN`, the schema's macro name pattern
- `IR_WIDGET_TYPES` (every IR widget `type` the spec defines),
  `WIDGET_DEFINITIONS` (each type's `propSchema` and `supports*` flags),
  `IRWidgetType`, `WidgetDefinition`. A definition's `id` is its
  `IRWidgetType`. Both exports are deep-frozen, since every importer shares
  them: copy a definition before changing it. Prop schemas are descriptive
  only for now: don't validate props against them.
- `@slaclab/canopy-screen-ir/schema.json`: the JSON Schema file itself.

## Updating the spec

Change canopy-spec first and tag a release there, then copy the new version in:

```bash
pnpm --filter @slaclab/canopy-screen-ir run spec:sync v0.2.0
```

The argument must be a canopy-spec release tag of the form `vX.Y.Z`; a branch
or commit is refused. The script fetches the tag with `git`, replaces `spec/`,
rewrites `spec.lock.json`, and regenerates `src/widgets.generated.ts`. Commit
all three. If any step fails, it changes nothing.

Don't edit anything under `spec/` by hand. CI runs `spec:check`, which fails
unless `spec/` is byte-identical to the tag in `spec.lock.json`, and
`src/spec.test.ts` fails if a file doesn't match its hash in the lock. Files
git ignores, such as `.DS_Store`, don't count.
`spec/LICENSE.md` is canopy-spec's license, kept next to the copies as it
requires.
