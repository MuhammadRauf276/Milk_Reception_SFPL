'use client';

import React, { useState, useRef, useEffect } from 'react';
import { MobileNumberInput } from '@/components/ui/mobile-number-input';
import { CollapsibleDisclosure } from '@/components/ui/collapsible-disclosure';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function TestPrimitivesClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. MobileNumberInput State
  const [numberVal, setNumberVal] = useState('4.5');

  // 3. Drawer State & Trigger Ref for focus restoration
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawerBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      setTimeout(() => openDrawerBtnRef.current?.focus(), 0);
    }
  };

  // 4. Action bar state
  const [actionCount, setActionCount] = useState(0);

  return (
    <div data-hydrated={mounted ? 'true' : undefined} className="p-4 space-y-8 max-w-4xl mx-auto pb-32">
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

      {/* 3. CollapsibleDisclosure */}
      <section className="space-y-2" data-testid="section-collapsible-disclosure">
        <h2 className="text-sm font-bold">3. CollapsibleDisclosure</h2>
        <CollapsibleDisclosure
          title="SOP Testing Guidelines"
          badge="Required"
          forceOpenDesktop
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
          ref={openDrawerBtnRef}
          type="button"
          data-testid="open-drawer-btn"
          onClick={() => setDrawerOpen(true)}
        >
          Open Mobile Drawer
        </Button>
        <Drawer open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
          <DrawerContent data-testid="drawer-content">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <DrawerTitle data-testid="drawer-title">Test Drawer Modal</DrawerTitle>
                <button
                  type="button"
                  data-testid="close-drawer-btn"
                  onClick={() => handleDrawerOpenChange(false)}
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
          <table className="w-full text-xs" style={{ minWidth: '700px' }}>
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Batch ID</th>
                <th className="p-2 text-left">Source Name</th>
                <th className="p-2 text-left">Quantity (KG)</th>
                <th className="p-2 text-left">Fat %</th>
                <th className="p-2 text-left">CLR</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-2">BATCH-001</td>
                <td className="p-2">Hasilpur Center Alpha</td>
                <td className="p-2">4,200.00</td>
                <td className="p-2">4.10%</td>
                <td className="p-2">29.0</td>
                <td className="p-2 text-emerald-600 font-bold">Passed</td>
              </tr>
              <tr className="border-b">
                <td className="p-2">BATCH-002</td>
                <td className="p-2">Chishtian Rural Hub</td>
                <td className="p-2">6,150.50</td>
                <td className="p-2">3.85%</td>
                <td className="p-2">28.5</td>
                <td className="p-2 text-blue-600 font-bold">In Testing</td>
              </tr>
            </tbody>
          </table>
        </TableWrapper>
      </section>

      {/* 6. StickyActionBar */}
      <section className="space-y-2" data-testid="section-action-bar">
        <h2 className="text-sm font-bold">6. StickyActionBar</h2>
        <StickyActionBar>
          <Button
            type="button"
            data-testid="action-bar-btn"
            onClick={() => setActionCount((c) => c + 1)}
            className="w-full"
          >
            Confirm Action ({actionCount})
          </Button>
        </StickyActionBar>
      </section>
    </div>
  );
}
