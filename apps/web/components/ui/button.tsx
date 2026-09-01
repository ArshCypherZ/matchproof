import {
  cloneElement,
  isValidElement,
  type Attributes,
  type ReactElement,
} from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* The one Button. Every clickable action in the app composes this variant
   set — a page never restyles a control. Press feedback is the shared
   scale-down; motion is the fast ease-out. */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 touch-manipulation items-center justify-center rounded-lg bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:scale-[0.96] active:not-aria-[haspopup]:disabled:scale-100 disabled:pointer-events-none disabled:bg-surface-subtle disabled:text-muted-foreground aria-disabled:pointer-events-none aria-disabled:bg-surface-subtle aria-disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border border-input bg-surface text-foreground hover:bg-surface-subtle aria-expanded:bg-surface-subtle",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70 aria-expanded:bg-secondary",
        ghost:
          "border border-transparent hover:bg-surface-subtle hover:text-foreground aria-expanded:bg-surface-subtle aria-expanded:text-foreground",
        destructive:
          "border border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/30",
        link: "border border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/* Touch floors: pointer-coarse devices get 44px-minimum interactive
   sizing at every button size, applied after the variant merge. The
   floor keys off data-size (the variant name travels in the attribute,
   so icon-sm / icon-xs / icon-lg match); className never carries it. */
const touchFloor =
  "pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-3.5 pointer-coarse:data-[size~='icon-sm']:size-11 pointer-coarse:data-[size~='icon-sm']:min-w-11 pointer-coarse:data-[size~='icon-xs']:size-11 pointer-coarse:data-[size~='icon-xs']:min-w-11 pointer-coarse:data-[size~='icon-lg']:size-11 pointer-coarse:data-[size~='icon-lg']:min-w-11";

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const classes = cn(buttonVariants({ variant, size }), touchFloor, className);
  // A rendered link keeps link semantics: Base UI's button behavior stamps
  // role="button" + tabindex on non-button elements, which misannounces
  // navigation as a button. Links styled as buttons stay links — announced
  // as links, Enter-activated, middle-clickable.
  if (render) {
    if (typeof render === "function") {
      // Base UI's render-function signature is narrower than its own Props
      // type; callers in this app only forward the props, so a loose
      // callable keeps both forms working without fighting the types.
      const renderFn = render as (
        props: Record<string, unknown>,
        state: { disabled: boolean },
      ) => ReactElement;
      return renderFn(
        { ...props, className: classes },
        { disabled: props.disabled === true },
      );
    }
    if (isValidElement(render)) {
      return cloneElement(
        render as ReactElement<Attributes & Record<string, unknown>>,
        { ...props, className: classes },
      );
    }
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      className={classes}
      nativeButton={nativeButton ?? true}
      {...props}
    />
  );
}

export { Button, buttonVariants };
