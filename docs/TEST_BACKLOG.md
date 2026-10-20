# Test backlog (to do after all phases are complete)

Owner rule (20 Oct 2026): no tests are written or updated during Phases 3 fixes → 8. Everything below is done in the final test phase.

## Phase 3

### Test files broken by later code changes (fix first)
- `src/backend/services/sync/__tests__/syncBatch.test.ts` — fake db still has `findFirst` / `stationPin` (removed from `SyncDb`); tests expecting `OWNER_NOT_ALLOWED` now get RETRY `OWNER_SESSION_REQUIRED`.
- `src/frontend/modules/pwa/__tests__/syncEngine.test.ts` — "500 / network error" and "200 device mode: SAVED removed" pass `ownerUserId: null` in device mode (only diary items are sent now).
- `src/backend/services/photo/__tests__/capturedPhoto.test.ts` — `PhotoFs` mock missing `rename` / `unlink`.

### New tests to write
- Sync owner rule: owner = assigned user OR session user; else RETRY `OWNER_SESSION_REQUIRED`; inactive owner REJECTED.
- Client `nextBatch` device-mode owner filter (signed-in owner's business items + all diary/heartbeat).
- `clientDiaryEventType`: LOGIN → CLIENT_LOGIN, STATION_PIN_SET → CLIENT_STATION_PIN_SET.
- `classifyPhotoHttp` (scope 403 → refused; DEVICE_NOT_ACTIVE → blocked; 401/408/429/5xx → retry) and `pendingPhotoUploads` owner filter.
- `settlePhotos`: one refused photo of two keeps the record waiting while the other uploads; NEEDS_ATTENTION only when nothing left and ≥1 refused.
- Photo upload owner rule (device + session), entity whitelist + scope check, row+audit in one transaction, P2002 race does not overwrite the winner's file.
- SyncStatusSign blocked state; PwaShell public paths (/station-login, /device-setup).
- Cron SMS route uses exact roles (no ancestor expansion).

## Phase 4a (later)
- resolveZmccAuth: HEAD_OF_MPD without a ZMCC source is still refused (system-scope superiors should be allowed with explicit zmcc id).
- UserMenu and ZmccArrivalsWorkspace still check PHE_OPERATOR directly.
- Pre-existing lint set-state-in-effect in MotOperationsWorkspace, ZmccMasterDataWorkspace, PendingApprovalsPanel.

## Phase 4b (later)
- Auto-close on all portions rejected closes the lab session, not MotJourney.status.
- Lab source requests use ZMCC_LAB_EXCEPTION_PENDING key; add REJECTED_MILK_REMARKS_PENDING catalog key (rejected milk notifies HEAD_OF_MPD directly).
- ZmccLocalSupplierArrival recorded_as_role columns exist but arrival code does not write them yet.
- Tank receipt still one per lab session (unique) until P4d migration.
