import { describe, it, expect } from 'vitest';
import * as qaValidations from '@/lib/validations/qa';
import fs from 'fs';
import path from 'path';

describe('QA Save Draft Capability Removal (Stage 4C-5H-R)', () => {
  it('R1 & R2: confirms production QA frontend files contain zero Save Draft actions or /draft calls', () => {
    const qaWorkspacePath = path.resolve(process.cwd(), 'src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx');
    const qaWorkspaceContent = fs.readFileSync(qaWorkspacePath, 'utf8');
    expect(qaWorkspaceContent).not.toContain('handleSaveDraft');
    expect(qaWorkspaceContent).not.toContain('Save Draft');
    expect(qaWorkspaceContent).not.toContain('/draft');

    const dynamicQaFormPath = path.resolve(process.cwd(), 'src/frontend/modules/forms/DynamicQALabForm.tsx');
    if (fs.existsSync(dynamicQaFormPath)) {
      const dynamicQaFormContent = fs.readFileSync(dynamicQaFormPath, 'utf8');
      expect(dynamicQaFormContent).not.toContain('handleSaveDraft');
      expect(dynamicQaFormContent).not.toContain('Save Draft');
      expect(dynamicQaFormContent).not.toContain('/draft');
    }
  });

  it('R3, R4, R5: completeQATestSchema and qaTestResultInputSchema are preserved for Accept / Reject', () => {
    expect(qaValidations.completeQATestSchema).toBeDefined();
    expect(qaValidations.qaTestResultInputSchema).toBeDefined();
    // saveQADraftSchema must not exist
    expect((qaValidations as any).saveQADraftSchema).toBeUndefined();
  });

  it('confirms the exclusive draft route file is removed from disk', () => {
    const draftRoutePath = path.resolve(
      process.cwd(),
      'src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/draft/route.ts'
    );
    expect(fs.existsSync(draftRoutePath)).toBe(false);
  });
});
