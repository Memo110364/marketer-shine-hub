import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium cursor-pointer select-none",
    "transition-all duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:saturate-50",
    "active:translate-y-px active:shadow-none",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,91,79,0.15),0_6px_16px_-8px_rgba(15,91,79,0.4)] hover:bg-primary/92 hover:shadow-[0_2px_4px_rgba(15,91,79,0.18),0_10px_24px_-10px_rgba(15,91,79,0.5)] active:bg-primary/95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(180,40,40,0.15),0_6px_16px_-8px_rgba(180,40,40,0.4)] hover:bg-destructive/92 active:bg-destructive/95",
        outline:
          "border border-border bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-secondary hover:text-secondary-foreground hover:border-primary/30 active:bg-secondary/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
        gold:
          "bg-accent text-accent-foreground shadow-[0_1px_2px_rgba(199,164,106,0.18),0_6px_16px_-8px_rgba(199,164,106,0.45)] hover:bg-accent/90 active:bg-accent/95",
        ghost:
          "text-foreground hover:bg-secondary hover:text-secondary-foreground active:bg-secondary/80",
        link:
          "text-primary underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
