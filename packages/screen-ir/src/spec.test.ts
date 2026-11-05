// The copy of slaclab/canopy-spec under ../spec must match spec.lock.json, and
// widgets.generated.ts must match the copied widget files. CI also runs
// `spec:check`, which compares the copy with the tag itself.
//
// The generated module is compared by content (type list and definitions), not
// as text: Prettier may reformat it on commit, so a text comparison would be
// brittle.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { gitFiles } from '../scripts/spec-lib.mjs';
import { MACRO_NAME_PATTERN } from './macros.js';
import { SCHEMA_VERSION } from './screen.js';
import { SUPPORTED_SCHEMA_VERSIONS } from './schemaVersion.js';
import { IR_WIDGET_TYPES, WIDGET_DEFINITIONS } from './widgets.js';
import schema from '../spec/screen-ir/screen-ir.schema.json' with { type: 'json' };

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const specDir = join(pkgDir, 'spec');

interface SpecLock {
  readonly repo: string;
  readonly ref: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
}
const lock = JSON.parse(readFileSync(join(pkgDir, 'spec.lock.json'), 'utf8')) as SpecLock;

// What git would commit under spec/ (so an ignored .DS_Store doesn't count), as
// whole-path-sorted paths relative to spec/.
const specFiles = gitFiles(pkgDir, ['spec'])
  .map((path) => path.slice('spec/'.length))
  .sort();

describe('spec copy', () => {
  it('is pinned to a canopy-spec release tag and commit', () => {
    // Until slaclab/canopy-spec#17 is released, the copy is pinned to that
    // PR's head; `spec:sync <tag>` to the release restores the tag-only check.
    expect(lock).toMatchObject({ repo: 'slaclab/canopy-spec', ref: 'pull/17/head' });
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('keeps the license next to the copies', () => {
    expect(specFiles).toContain('LICENSE.md');
  });

  it('has exactly the files listed in spec.lock.json', () => {
    expect(specFiles).toEqual(Object.keys(lock.files).sort());
  });

  it.each(Object.entries(lock.files))('%s is unedited', (path, hash) => {
    const actual = createHash('sha256')
      .update(readFileSync(join(specDir, path)))
      .digest('hex');
    expect(actual, `${path} differs from canopy-spec@${lock.ref}; re-run spec:sync`).toBe(hash);
  });
});

describe('generated widget module', () => {
  const widgetFiles = specFiles
    .filter((path) => path.startsWith('screen-ir/widgets/') && path.endsWith('.json'))
    .map((path) => path.slice('screen-ir/widgets/'.length, -'.json'.length))
    .sort();

  it('lists every widget definition file', () => {
    expect([...IR_WIDGET_TYPES]).toEqual(widgetFiles);
    expect(Object.keys(WIDGET_DEFINITIONS).sort()).toEqual(widgetFiles);
  });

  it.each(widgetFiles)('%s matches its file', (id) => {
    const file = JSON.parse(readFileSync(join(specDir, 'screen-ir/widgets', `${id}.json`), 'utf8'));
    expect(WIDGET_DEFINITIONS[id as keyof typeof WIDGET_DEFINITIONS]).toEqual(file);
  });
});

describe('constants read from the copied schema', () => {
  it('SUPPORTED_SCHEMA_VERSIONS and SCHEMA_VERSION', () => {
    expect([...SUPPORTED_SCHEMA_VERSIONS]).toEqual(schema.properties.schemaVersion.enum);
    expect(schema.properties.schemaVersion.enum).toContain(SCHEMA_VERSION);
  });

  it('MACRO_NAME_PATTERN', () => {
    expect(MACRO_NAME_PATTERN.source).toBe(schema.$defs.MacroDeclaration.properties.name.pattern);
  });
});
