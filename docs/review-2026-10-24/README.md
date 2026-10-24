# Neo review package — 2026-10-24

Reviewed baseline: [iannitram/neo@3f21d09](https://github.com/iannitram/neo/commit/3f21d090662cbcbd441d5207292e2c175ee1a01a), NEO 1.6.0. These documents record findings against that commit; later fixes may change their applicability.

- [Bug report and verification limits](BUG-REPORT.md): eight prioritized findings, four executed defect reproductions.
- [Nextcloud conversion plan](NEXTCLOUD-PLAN.md): architecture, persistence/format contracts, rollout and acceptance gates.
- [Revised roadmap proposal](ROADMAP.md): implementation status and gated milestones. The root roadmap remains the prior version until the proposal is adopted.
- [Code map](CODE-MAP.md) and [baseline symbol index](SYMBOL-INDEX.md).
- [Previous roadmap](ROADMAP.previous.md): original D1–D16 decisions retained for traceability.
- [GitHub issue index](ISSUES.md): bugs #8–#15, build/coding jobs #16–#27, and [tracking issue #28](https://github.com/iannitram/neo/issues/28).
- [Unit-run output](test-results.log) and [targeted reproduction output](reproductions.log).

## Verification

The review used a connector-retrieved text snapshot because the shell proxy could not clone the repo. The unit run passed 27 test files; three failed due to sandbox restrictions or missing binary assets/dependencies. GUI, mobile and real Nextcloud integration remain unverified. See the bug report for full limits. This documentation commit does not fix the reported bugs or deploy software.

To rerun the temporary-library defect probes from the repository root:

```sh
node docs/review-2026-10-24/review-repro.cjs
```

The probe asserts the observed buggy baseline behavior, so it is historical diagnostic evidence, not a regression suite expecting corrected behavior. Run it against the reviewed commit in a disposable checkout; it creates/removes only temporary libraries. Permanent regression tests should be added by the linked fix jobs.
