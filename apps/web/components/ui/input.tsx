import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-surface px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-subtle disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 sm:h-8 md:text-sm",
        /* Touch floor: applied after the base classes so the 44px height
           survives the sm:h-8 desktop step (the pointer-coarse media block
           sorts after sm: in the generated CSS). */
        "pointer-coarse:h-11",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
