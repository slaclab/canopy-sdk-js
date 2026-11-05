// validate() message strings are part of the public behavior (the builder shows
// them on export failures), so they're pinned here. Recorded from validate()
// before it was split into validateDetailed(); the inputs are the invalid
// canopy-spec conformance cases.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { validate } from './validate.js';

const ONE_ARM = '/root/children/0/rules/0 must match exactly one schema in oneOf';

const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  'invalid-formula-ref-in-prop-unresolved': [
    "widget 'w-002' prop 'pv' references formula 'missing' but no formulas[] entry declares it",
  ],
  'invalid-formula-ref-in-rule-formula-bare-name-unresolved': [
    "rule 'r-001' on widget 'w-002' references formula 'missing' but no formulas[] entry declares it",
  ],
  'invalid-formula-ref-in-rule-formula-unresolved': [
    "rule 'r-001' on widget 'w-002' references formula 'missing' but no formulas[] entry declares it",
  ],
  'invalid-formula-ref-in-rule-pv-unresolved': [
    "rule 'r-001' on widget 'w-002' pv references formula 'missing' but no formulas[] entry declares it",
  ],
  'invalid-macro-name-leading-digit': [
    '/macros/0/name must match pattern "^[A-Za-z][A-Za-z0-9_]*$"',
  ],
  'invalid-missing-root': ["(root) must have required property 'root'"],
  'invalid-rule-both-arms': [
    ...Array<string>(3).fill('/root/children/0/rules/0 must NOT have additional properties'),
    ONE_ARM,
  ],
  'invalid-rule-no-arm': [
    "/root/children/0/rules/0 must have required property 'pvs'",
    "/root/children/0/rules/0 must have required property 'conditions'",
    "/root/children/0/rules/0 must have required property 'formula'",
    ONE_ARM,
  ],
  'invalid-schema-version': ['/schemaVersion must be equal to one of the allowed values'],
  'invalid-screen-macro-without-default': [
    "macro 'dev' needs a default on a screen (kind='screen')",
  ],
  'invalid-template-macro-with-default': ["macro 'dev' must not declare a default on a template"],
  'invalid-widget-missing-geometry': ["/root/children/0 must have required property 'geometry'"],
  'invalid-widget-unknown-field': ['/root must NOT have additional properties'],
};

it.each(Object.entries(EXPECTED))('%s message is unchanged', (name, messages) => {
  const path = fileURLToPath(
    new URL(`../spec/conformance/screen-ir/validate/${name}.json`, import.meta.url)
  );
  const c = JSON.parse(readFileSync(path, 'utf8')) as { screen: unknown };
  expect(validate(c.screen)).toEqual(messages);
});
