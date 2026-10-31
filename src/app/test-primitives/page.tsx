'use client';

import React, { useState } from 'react';
import { MobileNumberInput } from '@/components/ui/mobile-number-input';
import { QuickRemarksChips } from '@/components/ui/quick-remarks-chips';
import { CollapsibleDisclosure } from '@/components/ui/collapsible-disclosure';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function TestPrimitivesPage() {
  // 1. MobileNumberInput State
  const [numberVal, setNumberVal] = useState('4.5');

  // 2. QuickRemarksChips State
  const [remarks, setRemarks] = useState('');

  // 3. Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 4. Action bar state
  const [actionCount, setActionCount] = useState(0);

  return (
    <div className="p-4 space-y-8 max-w-4xl mx-auto pb-32">
      <h1 className="text-xl font-bold">Mobile Component Primitives Test Harness</h1>

      {/* 1. MobileNumberInput */}
      <section className="space-y-2" data-testid="section-mobile-number-input">
        <h2 className="text-sm font-bold">1. MobileNumberInput</h2>
        <MobileNumberInput
          id="test-number-input"
          data-testid="mobile-number-input"
          value={numberVal}
          onValueChange={setNumberVal}
          unit="°C"
          step={0.5}
          min={0}
          max={20}
          showSteppers
          allowClear
          placeholder="0.00"
        />
        <div data-testid="number-value-display" className="text-xs font-mono">
          Value: {numberVal}
        </div>
      </section>

      {/* 2. QuickRemarksChips */}
      <section className="space-y-2" data-testid="section-quick-remarks">
        <h2 className="text-sm font-bold">2. QuickRemarksChips</h2>
        <QuickRemarksChips
          presets={['Sample In Spec', 'Seal Checked', 'Temp Deviation']}
          value={remarks}
          onChange={setRemarks}
          label="Operational Presets:"
        />
        <textarea
          data-testid="remarks-textarea"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Remarks"
          className="w-full border border-border p-2 text-base rounded-md"
        />
        <div data-testid="remarks-value-display" className="text-xs font-mono">
          Remarks: {remarks}
        </div>
      </section>

      {/* 3. CollapsibleDisclosure */}
      <section className="space-y-2" data-testid="section-disclosure">
        <h2 className="text-sm font-bold">3. CollapsibleDisclosure</h2>
        <CollapsibleDisclosure
          title="SOP Testing Guidelines"
          badge={<span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">Standard</span>}
          defaultOpen={false}
          forceOpenDesktop={true}
        >
          <div data-testid="disclosure-content">
            Detailed SOP testing guidelines and audit compliance rules for milk reception.
          </div>
        </CollapsibleDisclosure>
      </section>

      {/* 4. Drawer */}
      <section className="space-y-2" data-testid="section-drawer">
        <h2 className="text-sm font-bold">4. Drawer</h2>
        <Button
          type="button"
          data-testid="open-drawer-btn"
          onClick={() => setDrawerOpen(true)}
        >
          Open Mobile Drawer
        </Button>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent data-testid="drawer-content">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <DrawerTitle data-testid="drawer-title">Test Drawer Modal</DrawerTitle>
                <button
                  type="button"
                  data-testid="close-drawer-btn"
                  onClick={() => setDrawerOpen(false)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p>Drawer test content inside mobile modal sheet.</p>
            </div>
          </DrawerContent>
        </Drawer>
      </section>

      {/* 5. TableWrapper */}
      <section className="space-y-2" data-testid="section-table">
        <h2 className="text-sm font-bold">5. TableWrapper</h2>
        <TableWrapper data-testid="test-table-wrapper">
          <table className="w-full min-w-[700px] text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2">Col 1</th>
                <th className="p-2">Col 2</th>
                <th className="p-2">Col 3</th>
                <th className="p-2">Col 4</th>
                <th className="p-2">Col 5</th>
                <th className="p-2">Col 6</th>
                <th className="p-2">Col 7</th>
                <th className="p-2">Col 8</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2">Data 1</td>
                <td className="p-2">Data 2</td>
                <td className="p-2">Data 3</td>
                <td className="p-2">Data 4</td>
                <td className="p-2">Data 5</td>
                <td className="p-2">Data 6</td>
                <td className="p-2">Data 7</td>
                <td className="p-2">Data 8</td>
              </tr>
            </tbody>
          </table>
        </TableWrapper>
      </section>

      {/* 6. StickyActionBar */}
      <section className="space-y-2" data-testid="section-sticky-action-bar">
        <h2 className="text-sm font-bold">6. StickyActionBar</h2>
        <StickyActionBar data-testid="test-sticky-action-bar">
          <Button
            type="button"
            data-testid="action-bar-btn"
            onClick={() => setActionCount((c) => c + 1)}
          >
            Confirm Action ({actionCount})
          </Button>
        </StickyActionBar>
      </section>
    </div>
  );
}
