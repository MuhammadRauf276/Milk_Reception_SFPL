/** One loader per Visuals tab. Each loader owns its own file and contract. */
import type { VisualTab, VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { VisualsDb } from './visualsCommon';
import { loadShopsVisuals } from './shopsVisuals';
import { loadTestersVisuals } from './testersVisuals';
import { loadHcVisuals } from './hcVisuals';
import { loadZmccVisuals } from './zmccVisuals';
import { loadPlantVisuals } from './plantVisuals';

export const VISUAL_LOADERS: Record<VisualTab, (q: VisualsQuery, db: VisualsDb) => Promise<unknown>> = {
  SHOPS: loadShopsVisuals,
  TESTERS: loadTestersVisuals,
  HC: loadHcVisuals,
  ZMCC: loadZmccVisuals,
  PLANT: loadPlantVisuals,
};
