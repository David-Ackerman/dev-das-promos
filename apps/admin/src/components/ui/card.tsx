import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-sm font-medium text-neutral-400", className)} {...props} />;
}

export function CardValue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("mt-1 text-2xl font-semibold", className)} {...props} />;
}
