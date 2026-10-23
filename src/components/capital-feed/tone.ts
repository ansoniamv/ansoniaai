// Category colours shared by the story cards and the page's filters and rail.
import type { StoryCategory } from "@/lib/capitalFeed";

export const CATEGORY_TONE: Record<StoryCategory, { text: string; rule: string; dot: string }> = {
  note: { text: "text-sky-700 dark:text-sky-400", rule: "bg-sky-700 dark:bg-sky-400", dot: "bg-sky-600" },
  criteria: { text: "text-amber-700 dark:text-amber-400", rule: "bg-amber-700 dark:bg-amber-400", dot: "bg-amber-600" },
};
