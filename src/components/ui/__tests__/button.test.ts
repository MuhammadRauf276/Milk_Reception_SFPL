import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonVariants } from '../button';

test('Button: primary action prominence vs secondary and outline', () => {
  const primaryClass = buttonVariants({ variant: 'default' });
  const secondaryClass = buttonVariants({ variant: 'secondary' });
  const outlineClass = buttonVariants({ variant: 'outline' });
  const ghostClass = buttonVariants({ variant: 'ghost' });
  const destructiveClass = buttonVariants({ variant: 'destructive' });

  // 1. Primary action must have high-visibility primary background
  assert(primaryClass.includes('bg-primary'), 'Primary action must use bg-primary for maximum prominence');
  assert(primaryClass.includes('text-primary-foreground'), 'Primary action must have contrasting foreground text');

  // 2. Secondary action must be less prominent with subdued neutral surface
  assert(secondaryClass.includes('bg-secondary'), 'Secondary action must use bg-secondary');
  assert(secondaryClass.includes('border-border-strong'), 'Secondary action must have clean boundary border');
  assert(!secondaryClass.includes('bg-primary'), 'Secondary action must never use primary background');

  // 3. Outline action must have brand action accent without overpowering primary
  assert(outlineClass.includes('text-action'), 'Outline action must use action color');
  assert(outlineClass.includes('border-action'), 'Outline action must have action border');

  // 4. Destructive action must have clear warning danger state
  assert(destructiveClass.includes('bg-destructive'), 'Destructive action must use bg-destructive');

  // 5. Ghost action must have no heavy background
  assert(ghostClass.includes('hover:bg-muted'), 'Ghost action must use subtle hover');
});

test('Button: interactive states (pressed, focus, disabled, touch targets)', () => {
  const baseClasses = buttonVariants();

  // 1. Pressed state tactile feedback
  assert(baseClasses.includes('active:scale-[0.98]'), 'Button must have active pressed scale transform');

  // 2. Focus state accessibility
  assert(baseClasses.includes('focus-visible:ring-2'), 'Button must have high-contrast focus ring');
  assert(baseClasses.includes('focus-visible:ring-ring'), 'Button must link focus ring to design token');
  assert(baseClasses.includes('focus-visible:ring-offset-2'), 'Button focus ring must have distinct offset');

  // 3. Disabled state
  assert(baseClasses.includes('disabled:opacity-50'), 'Button must drop opacity when disabled');
  assert(baseClasses.includes('disabled:cursor-not-allowed'), 'Button must display cursor-not-allowed when disabled');
  assert(baseClasses.includes('disabled:pointer-events-none'), 'Button must prevent pointer events when disabled');

  // 4. Touch target compliance (minimum 44px for accessibility on all sizes)
  assert(buttonVariants({ size: 'default' }).includes('min-h-11'), 'Default size must meet 44px minimum touch target');
  assert(buttonVariants({ size: 'sm' }).includes('min-h-11'), 'Small size must preserve 44px minimum touch target');
  assert(buttonVariants({ size: 'icon' }).includes('min-h-11'), 'Icon size must preserve 44px minimum touch target');
});
