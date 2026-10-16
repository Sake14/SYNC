import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  value,
  max = 100,
  style,
  ...props
}: ComponentProps<"input">) {
  const progress =
    Number(max) > 0 ? (Number(value ?? 0) / Number(max)) * 100 : 0;
  return (
    <input
      type="range"
      data-slot="slider"
      className={cn("slider", className)}
      value={value}
      max={max}
      style={{
        ...style,
        backgroundImage: `linear-gradient(to right, var(--primary) ${progress}%, var(--border) ${progress}%)`,
      }}
      {...props}
    />
  );
}
