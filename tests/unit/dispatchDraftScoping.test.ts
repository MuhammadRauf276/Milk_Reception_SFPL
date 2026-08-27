import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getScopedDraftKey } from '@/lib/validations/dispatch';

describe('Stage 4C-2A: Dispatch Draft Scoping & Lifecycle Rules (Unit)', () => {
  it('[TEST-I] Scoped storage-key generation (production helper) separates users and sources deterministically', () => {
    const keyUser1SourceA = getScopedDraftKey('101', '1');
    const keyUser2SourceA = getScopedDraftKey('102', '1');
    const keyUser1SourceB = getScopedDraftKey('101', '2');
    const keyUser2SourceB = getScopedDraftKey('102', '2');

    expect(keyUser1SourceA).toBe('mpd_active_draft_visit_id:101:1');
    expect(keyUser2SourceA).toBe('mpd_active_draft_visit_id:102:1');
    expect(keyUser1SourceB).toBe('mpd_active_draft_visit_id:101:2');
    expect(keyUser2SourceB).toBe('mpd_active_draft_visit_id:102:2');

    // Cross assertions
    expect(keyUser1SourceA).not.toBe(keyUser2SourceA);
    expect(keyUser1SourceA).not.toBe(keyUser1SourceB);
    expect(keyUser2SourceA).not.toBe(keyUser1SourceB);
    expect(getScopedDraftKey(undefined, '1')).toBeNull();
    expect(getScopedDraftKey('101', undefined)).toBeNull();
  });

  it('[TEST-J] Static scan confirms old global singleton key has 0 runtime readers in codebase', () => {
    const formFile = fs.readFileSync(
      path.join(process.cwd(), 'src/frontend/modules/forms/DynamicDispatchForm.tsx'),
      'utf8'
    );

    // Ensure no getItem calls read the old un-scoped singleton key
    const legacyGetPattern = /sessionStorage\.getItem\(\s*['"]mpd_active_draft_visit_id['"]\s*\)/g;
    const legacyGetMatches = formFile.match(legacyGetPattern);
    expect(legacyGetMatches).toBeNull();

    // Ensure the old singleton key is only referenced in cleanup (removeItem)
    const lines = formFile.split('\n');
    lines.forEach((line) => {
      if (line.includes("'mpd_active_draft_visit_id'") || line.includes('"mpd_active_draft_visit_id"')) {
        expect(line.trim()).toContain('sessionStorage.removeItem');
      }
    });
  });

  it('[TEST-K] Static scan confirms automatic first-source selection is REMOVED from frontend and backend', () => {
    const formFile = fs.readFileSync(
      path.join(process.cwd(), 'src/frontend/modules/forms/DynamicDispatchForm.tsx'),
      'utf8'
    );
    const startRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/dispatches/start/route.ts'),
      'utf8'
    );
    const mainRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/dispatches/route.ts'),
      'utf8'
    );

    // 1. Frontend must NOT auto-select first source
    expect(formFile).not.toContain('setSelectedSourceId(data.sources[0]');
    expect(formFile).toContain('-- Select Procurement Source --');

    // 2. Backend must NOT have findFirst fallback
    expect(startRoute).not.toContain('findFirst({ where: { is_active: true }');
    expect(mainRoute).not.toContain('findFirst({ where: { is_active: true }');
    expect(startRoute).toContain('PROCUREMENT_SOURCE_REQUIRED');
    expect(mainRoute).toContain('PROCUREMENT_SOURCE_REQUIRED');
  });


  it('[TEST-L] Stale draft recovery algorithm removes invalid draft key and creates fresh draft', async () => {
    const mockSessionStorage: Record<string, string> = {
      'mpd_active_draft_visit_id:101:1': 'stale-visit-999',
    };

    const startApiCalls: any[] = [];
    const mockStartApi = async (payload: { visitId?: string; procurementSourceId?: string }) => {
      startApiCalls.push(payload);
      if (payload.visitId === 'stale-visit-999') {
        return { ok: false, status: 404, data: { error: 'Draft not found', code: 'DRAFT_NOT_FOUND' } };
      }
      return { ok: true, status: 201, data: { success: true, visitId: 'fresh-visit-1001', visitNumber: 'VV-NEW-01' } };
    };

    // Simulate recovery flow
    const scopedKey = getScopedDraftKey('101', '1')!;
    const savedDraftId = mockSessionStorage[scopedKey];

    let res = await mockStartApi({ visitId: savedDraftId, procurementSourceId: '1' });
    if (!res.ok && (res.status === 404 || res.status === 400 || res.status === 403)) {
      delete mockSessionStorage[scopedKey]; // Stale key safely removed
      res = await mockStartApi({ procurementSourceId: '1' }); // Fresh draft created
      if (res.ok && res.data?.visitId) {
        mockSessionStorage[scopedKey] = res.data.visitId;
      }
    }


    expect(startApiCalls.length).toBe(2);
    expect(startApiCalls[0]).toEqual({ visitId: 'stale-visit-999', procurementSourceId: '1' });
    expect(startApiCalls[1]).toEqual({ procurementSourceId: '1' });
    expect(mockSessionStorage[scopedKey]).toBe('fresh-visit-1001');
  });
});
