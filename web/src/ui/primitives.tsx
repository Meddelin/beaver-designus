import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

/* ─── Button ────────────────────────────────────────────────────────────── */

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 select-none whitespace-nowrap",
    "font-medium transition-[background,color,border-color,box-shadow,transform] duration-120 ease-snap",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper-0",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-[var(--accent-contrast)] hover:brightness-[1.04] shadow-[0_1px_0_0_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.04)_inset]",
        secondary:
          "bg-paper-2 text-ink-0 border border-line hover:bg-paper-3 hover:border-line-strong",
        ghost:
          "bg-transparent text-ink-1 hover:text-ink-0 hover:bg-paper-2",
        outline:
          "bg-transparent text-ink-0 border border-line-strong hover:bg-paper-2",
        danger:
          "bg-state-danger/15 text-state-danger border border-state-danger/30 hover:bg-state-danger/20",
      },
      size: {
        xs: "h-7 px-2 text-[12px] rounded-sm",
        sm: "h-8 px-3 text-[13px] rounded-md",
        md: "h-9 px-4 text-[13.5px] rounded-md",
        lg: "h-11 px-5 text-[14px] rounded-md",
        icon: "h-9 w-9 rounded-md",
        "icon-sm": "h-8 w-8 rounded-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...rest }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  )
);
Button.displayName = "Button";

/* ─── IconButton (square ghost by default, lucide icon as child) ────────── */

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "icon", ...rest }, ref) => (
    <Button ref={ref} variant={variant} size={size} className={cn("p-0", className)} {...rest} />
  )
);
IconButton.displayName = "IconButton";

/* ─── Pill (small label / status) ───────────────────────────────────────── */

const pillVariants = cva(
  "inline-flex items-center gap-1 h-5 px-2 text-[10.5px] font-mono tracking-wide uppercase rounded-sm border tabular",
  {
    variants: {
      tone: {
        neutral: "bg-paper-2 text-ink-2 border-line",
        accent: "bg-accent/12 text-accent border-accent/30",
        success: "bg-state-success/12 text-state-success border-state-success/30",
        warning: "bg-state-warning/12 text-state-warning border-state-warning/30",
        danger: "bg-state-danger/15 text-state-danger border-state-danger/30",
        info: "bg-state-info/12 text-state-info border-state-info/30",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, ...rest }: PillProps): React.ReactElement {
  return <span className={cn(pillVariants({ tone }), className)} {...rest} />;
}

/* ─── Kbd (key cap) ─────────────────────────────────────────────────────── */

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1",
        "font-mono text-[10.5px] text-ink-2 bg-paper-2 border border-line rounded-[4px]",
        "shadow-[inset_0_-1px_0_0_var(--line)] tabular",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/* ─── Card ──────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  interactive = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-paper-1 transition-[border-color,background,transform,box-shadow] duration-200 ease-snap",
        interactive && "cursor-pointer hover:border-line-strong hover:bg-paper-2 hover:-translate-y-px hover:shadow-elev-2",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ─── SectionTitle ──────────────────────────────────────────────────────── */

export function SectionTitle({
  children,
  hint,
  action,
  className,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 mb-3", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-medium text-ink-0 tracking-tight">{children}</h2>
        {hint ? <span className="text-[12px] text-ink-3 font-mono tabular">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

/* ─── Divider with optional caption ─────────────────────────────────────── */

export function Divider({ children, className }: { children?: React.ReactNode; className?: string }): React.ReactElement {
  if (!children) return <hr className={cn("border-t border-line my-3", className)} />;
  return (
    <div className={cn("flex items-center gap-3 my-3", className)}>
      <div className="flex-1 border-t border-line" />
      <span className="text-[10.5px] font-mono uppercase tracking-widest text-ink-3">{children}</span>
      <div className="flex-1 border-t border-line" />
    </div>
  );
}
