import type { Transition, Variants } from 'framer-motion';

/** Slight, professional motion: short fades with a few px of travel. MotionConfig (reducedMotion="user") already tones these down. */
export const ease = [0.22, 1, 0.36, 1] as const;

export const fast: Transition = { duration: 0.15, ease };
export const base: Transition = { duration: 0.2, ease };

/** Panel/step content switching. Use with <AnimatePresence mode="wait" initial={false}>. */
export const fadeSlide: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: base },
  exit: { opacity: 0, y: -4, transition: fast },
};

/** List/table rows appearing: parent uses `stagger`, rows use `item`. Keep lists under ~12 animated rows. */
export const stagger: Variants = {
  animate: { transition: { staggerChildren: 0.03 } },
};
export const item: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: base },
};

/** Tiny press feedback for buttons/cards: <motion.button whileTap={tap}>. */
export const tap = { scale: 0.98 } as const;
