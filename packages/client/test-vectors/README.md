# Vendored canopy contract vectors

The two JSON files here are byte copies of canopy's contract vector files. canopy defines them; this package only
tests against them.

| File | canopy source | git blob |
|------|---------------|----------|
| `heartbeat_vectors.json` | `src/canopy/contracts/heartbeat_vectors.json` | `cc10af4e9fc30111de2073006a543ff7d9cffa04` |
| `write_outcome_vectors.json` | `src/canopy/contracts/write_outcome_vectors.json` | `2cd15e2f5fed1fb3f0b1b3f5d3e90ec03020ad9c` |

Both copies match canopy commit `23c082f9f783e8532a520b147c8faf934f95ab3b`, which last changed either file (the
`asked` and `held` write states). That commit is not on canopy `main` yet. `git hash-object <file>` here must print the blob
above, and equal `git rev-parse <canopy commit>:<canopy source>`.

- `heartbeat_vectors.json`: what a heartbeat's `reachable` and `writes` fields mean and what the viewer shows for
  them. Read by `src/hare/HarePVService.test.ts`.
- `write_outcome_vectors.json`: the write-outcome table, one row per way a screen write can end. Read by
  `src/hare/submit.test.ts`, which checks `src/hare/writeOutcome.ts` against it.

## Rules

- Never edit or reformat these files here. `.prettierignore` excludes this directory.
- canopy's `tests/canopy/contracts/test_heartbeat_vectors_vendor.py` and `test_write_outcome_vectors_vendor.py`
  compare the raw bytes of these copies with canopy's files when `CANOPY_SCHEMA_SIBLINGS` points at a checkout of
  this repo.
- To update: change the file in canopy first, copy it here byte for byte, and update the commit and blobs above.
