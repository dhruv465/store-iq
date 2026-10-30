import * as React from "react";
import { cn } from "@/lib/utils";

// 13 and 6 share no factor, so numbers that differ by one digit still change both the animal and the tint.
const EMOJI = ["🦊", "🐼", "🐯", "🦁", "🐨", "🐸", "🐙", "🦉", "🐧", "🦄", "🐳", "🦋", "🐢"];
const TINT = [
  "bg-red-100 dark:bg-red-900/40",
  "bg-amber-100 dark:bg-amber-900/40",
  "bg-green-100 dark:bg-green-900/40",
  "bg-sky-100 dark:bg-sky-900/40",
  "bg-violet-100 dark:bg-violet-900/40",
  "bg-pink-100 dark:bg-pink-900/40",
];

/** The same seed (the associate's phone) always draws the same animal and tint. The seed is never rendered. */
function Avatar({ seed, className, ...props }: { seed: string } & React.ComponentProps<"span">) {
  // shortcut: two associates can land on the same emoji and tint, which is fine at one store's headcount.
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      data-slot="avatar"
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-base leading-none",
        TINT[h % TINT.length],
        className,
      )}
      {...props}
    >
      {EMOJI[h % EMOJI.length]}
    </span>
  );
}

export { Avatar };
