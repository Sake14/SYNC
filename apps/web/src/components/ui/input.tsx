import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn("h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 aria-invalid:border-red-400", className)} {...props} />;
}
