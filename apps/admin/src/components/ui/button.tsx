"use client";

import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "outline" | "destructive" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  default: "bg-blue-600 text-white hover:bg-blue-500",
  outline: "border border-neutral-700 text-neutral-200 hover:bg-neutral-800",
  destructive: "bg-red-600 text-white hover:bg-red-500",
  ghost: "text-neutral-300 hover:bg-neutral-800",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "default", className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
