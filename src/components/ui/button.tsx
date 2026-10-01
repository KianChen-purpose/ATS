import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm",
  secondary: "bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 shadow-xs",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: "sm" | "md";
};

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
        variants[variant],
        className,
      )}
    />
  );
}

/** Same look as Button, for Next <Link>s and anchors. */
export function buttonClass(variant: keyof typeof variants = "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
    size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
    variants[variant],
  );
}
