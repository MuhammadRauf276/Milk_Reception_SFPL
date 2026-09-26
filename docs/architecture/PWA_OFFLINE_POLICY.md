# PWA Offline Policy

This policy applies to the installed Milk Reception application. It protects stock, laboratory decisions, approvals, correction authority, and financial records when a device loses connectivity.

## Common rules

- A device must first open and prepare its allowed workspace while online.
- The application never stores a password for offline reuse.
- Every queued action has a client event ID and is replayed only after online authentication is valid.
- Server authorization, source assignment, active status, lifecycle guards, and duplicate protection are rechecked at synchronization time.
- The application clearly shows offline, synchronizing, rejected, and signed-out states.

## Role capability matrix

| Role/workspace | Offline allowed | Online only |
|---|---|---|
| MOT | Prepared current journey, assigned shops, collection drafts, GPS queue, map pack, collection outbox | Assignment, corrections, journey approval/cancel, final synchronization |
| PHE Operator | View prepared assigned arrival reference data only | Gate arrival submission, corrections, tokens, approvals |
| ZMCC Lab Attendant | View prepared in-progress session evidence only | Lab session start/completion, acceptance/rejection, tank receipt, RMR issue |
| QA Lab Attendant | View prepared current visit evidence only | Test completion, acceptance/rejection, manager exception |
| ZMCC/QA/MPD/Admin heads | Read only cached safe shell | Decisions, corrections, approvals, configuration, audit review |
| Finance | No business data cache | Reporting, target changes, settlement, posting, payment |
| Super Admin/Data Executive | No administrative data cache | All administration, configuration, user/device control |
| Security/Weighbridge/Production | No operational write cache | Gate, weights, unloading, exit, stock actions |

## Offline authorization boundary

The MOT-specific preparation flow is the only approved operational write cache. It may contain the active user ID, active journey ID, assigned source, expiry, and a server-signed device authorization envelope. It must not contain a password, refresh token, broad session cookie, or permissions beyond the prepared journey.

An expired, revoked, reassigned, cancelled, completed, or signed-out preparation envelope blocks new offline writes. Existing local drafts remain visible for recovery but cannot be synchronized until the authorized operator signs in online again.

## Recovery and cleanup

Online logout revokes push subscriptions and clears prepared operational caches for the account. Role/source reassignment, deactivation, and application version upgrade require a fresh online preparation. A shared device must not switch operational users until the previous user has synchronized or explicitly discarded allowed local drafts while online.
