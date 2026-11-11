// Moves stored photos into the traceable folder layout. Run once after deploying, and again any time; it only moves
// what is not yet in place.  npm run photos:organize            (moves)
//                            npm run photos:organize -- --dry-run (only lists)
import { prisma } from '../src/backend/core/db';
import { reorganizePhotos } from '../src/backend/services/photo/reorganizePhotos';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const r = await reorganizePhotos({ dryRun });
  console.log(`${dryRun ? 'Would move' : 'Moved'} ${r.moved} of ${r.checked} photos and ${r.replacedMoved} replaced pictures.`);
  if (r.missing.length) console.log(`Files not found (left as they are):\n  ${r.missing.join('\n  ')}`);
  if (r.manifest) console.log(`List of moves: ${r.manifest}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
