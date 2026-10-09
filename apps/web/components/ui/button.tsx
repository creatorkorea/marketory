import * as React from "react";
import Link from "next/link";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", {
  variants: { variant: { primary: "button-primary", secondary: "button-secondary" } },
  defaultVariants: { variant: "primary" },
});
type Props = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ className, variant, asChild = false, type, ...props }: Props) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...(!asChild ? { type: type ?? "button" } : {})} {...props} />;
}

export function ButtonLink({ className, variant, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant }), className)} {...props} />;
}
