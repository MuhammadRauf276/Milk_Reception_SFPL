/** One loader per Visuals tab. Each loader owns its own file and contract. */
import type { VisualTab, VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { VisualsDb } from './visualsCommon';
import { loadShopsVisuals } from './shopsVisuals';
import { loadTestersVisuals } from './testersVisuals';
import { loadHcVisuals } from './hcVisuals';
import { loadZmccVisuals } from './zmccVisuals';
import { loadPlantVisuals } from './plantVisuals';
import { loadTankersVisuals } from './tankersVisuals';
import { loadFlowVisuals } from './flowVisuals';

export const VISUAL_LOADERS: Record<VisualTab, (q: VisualsQuery, db: VisualsDb) => Promise<unknown>> = {
  FLOW: loadFlowVisuals,
  SHOPS: loadShopsVisuals,
  TESTERS: loadTestersVisuals,
  HC: loadHcVisuals,
  ZMCC: loadZmccVisuals,
  TANKERS: loadTankersVisuals,
  PLANT: loadPlantVisuals,
};
