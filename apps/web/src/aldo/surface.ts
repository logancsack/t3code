// The few looks Aldo's conversation is made of (AldoConversationPage.tsx), in
// one place so every card, button and inset matches: a card is one flat
// surface with a hairline edge (only the composer, where you type, is raised),
// what to do is one black (white in dark) button, everything else is quiet.
// The theme carries the mark; a status dot shows what needs the user.

/** A card in the conversation: flat, with a hairline edge. */
export const SURFACE =
  "rounded-[20px] border border-foreground/[0.07] bg-card dark:border-white/[0.08] dark:bg-white/[0.045]";

/** What's quoted inside a card: an email, a plan, a command. */
export const INSET = "rounded-xl bg-foreground/[0.035] p-3.5 dark:bg-white/[0.04]";

/** What a keyboard shows it's on: a ring clear of the edge. */
export const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const BUTTON = `inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-full px-5 font-medium text-[14px] leading-5 transition-[background-color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS}`;

/** The one thing to do. */
export const PRIMARY = `${BUTTON} bg-foreground text-background hover:bg-foreground/88`;

/** Anything else to do. */
export const SECONDARY = `${BUTTON} bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.10]`;

/** A suggestion to start from: a quiet pill that fills the composer, never sends. */
export const CHIP = `inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground/[0.05] px-3.5 text-[14px] text-foreground/80 transition-colors hover:bg-foreground/[0.09] hover:text-foreground pointer-coarse:h-11 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] ${FOCUS}`;

/** A round button with just an icon (open, peek, more): small to see, a thumb's size to tap. */
export const ICON_BUTTON = `inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-11 ${FOCUS}`;
