import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-center rounded-lg text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.98] active:translate-y-[1px] active:brightness-90 active:shadow-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 disabled:cursor-not-allowed disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:saturate-50 aria-disabled:cursor-not-allowed max-w-full cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        // Primary Action: Bold Shakarganj red, high contrast, prominent shadow, top of visual hierarchy
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-sm active:bg-primary-hover active:brightness-95 active:shadow-inner',
        // High-risk or destructive action: Distinct danger tone
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 hover:shadow-sm active:brightness-95 active:shadow-inner',
        // Secondary Action with brand action accent (deep navy tint): Clear action affordance without competing with primary
        outline:
          'border border-action/30 bg-action-soft text-action shadow-2xs hover:border-action/50 hover:bg-action/15 hover:text-action active:bg-action/25 [&_svg]:text-current!',
        // Secondary Action (Neutral): Clean, clearly subordinate to primary action (used for Cancel, Back, Close)
        secondary:
          'border border-border-strong bg-secondary text-secondary-foreground shadow-2xs hover:bg-muted hover:text-foreground hover:border-border-strong active:bg-muted/80',
        // Tertiary Action: Minimal footprint for toolbars, inline options, and soft actions
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80',
        // Link Action: Styled as an interactive text link
        link:
          'text-primary underline-offset-4 hover:underline active:scale-100 font-medium p-0 h-auto min-h-0 shadow-none',
      },
      size: {
        default: 'min-h-11 px-4 py-2',
        sm: 'min-h-11 rounded-md px-3 text-xs',
        lg: 'min-h-12 rounded-lg px-6 text-base font-semibold',
        icon: 'min-h-11 min-w-11 p-2',
        'icon-sm': 'min-h-11 min-w-11 p-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingText?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      type,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isBusy = Boolean(loading);
    const isDisabled = Boolean(disabled) || isBusy;

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          isBusy && 'disabled:cursor-wait disabled:opacity-85 disabled:saturate-100 ring-2 ring-current/25 shadow-none'
        )}
        ref={ref}
        type={asChild ? undefined : type ?? 'button'}
        disabled={asChild ? undefined : isDisabled}
        tabIndex={asChild && isDisabled ? -1 : props.tabIndex}
        aria-busy={isBusy ? 'true' : undefined}
        aria-disabled={isDisabled ? 'true' : undefined}
        data-state={isBusy ? 'loading' : undefined}
        data-loading={isBusy ? 'true' : undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {isBusy ? (
              <Loader2
                className="size-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {isBusy && loadingText !== undefined ? loadingText : children}
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
