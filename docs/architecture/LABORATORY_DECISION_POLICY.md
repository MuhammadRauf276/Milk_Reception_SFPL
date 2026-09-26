# Laboratory decision policy

## Current official rule categories

`LabTestRule.rule_category` is the authoritative classification for the configured test at its testing point and effective time.

| Category | Current meaning | Final-decision effect |
|---|---|---|
| `RELEASE` | A required quality/release check | Out-of-spec result recommends rejection and enters the manager decision queue. |
| `MONITORING` | A monitored operating characteristic | Warning only; it does not replace or hide a release rule. |
| `INFORMATIONAL` | Future supported category for recorded context | No acceptance decision effect. It must not be treated as a missing release rule. |

## Hard stops

No test is currently configured as a non-overridable hard stop. The system must not infer one from a test name or a failed value.

QA Head must explicitly designate any future hard-stop rule, with the testing point, effective date, reason, and audit record. A hard stop then prevents manager acceptance and requires record rejection or a separately approved emergency workflow defined by QA/Finance policy.

Until that configuration exists, every `OUT_OF_SPEC` release result remains a rejection recommendation that requires an audited manager final decision. Rule configuration errors and missing required release rules fail closed and are not manager-overridable.

## Existing official configuration

The configured ranges, categorical options, units, and testing points remain official. Changes to limits belong to QA Head; catalog and assignment metadata belong to Data Executive; Super Admin may manage both. Historical sessions preserve their frozen snapshots and applied rule versions.
