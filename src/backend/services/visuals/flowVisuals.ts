/**
 * Loss flow tab. Every figure comes from getZmccStageChain (reused, never rewritten): purchased, area, intake,
 * dispatched, transit and plant, in total, per ZMCC and per day. Nothing is stored; the browser draws it.
 */
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { FlowVisuals } from '@/backend/modules/management-reporting/visuals/flowContracts';
import { loadZmccVisuals } from './zmccVisuals';
import type { VisualsDb } from './visualsCommon';

/** The stage chain plus the tank ledger (same ledger logic as the ZMCC tab, reused). */
export async function loadFlowVisuals(q: VisualsQuery, db: VisualsDb): Promise<FlowVisuals> {
  const { stage, tanks } = await loadZmccVisuals(q, db);
  return { stage, tanks };
}
