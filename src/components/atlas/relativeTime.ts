import { formatDistanceToNowStrict, isToday, isYesterday, isAfter, subDays } from "date-fns";

/** Compact relative stamp for a message row: "just now", "4m", "2h", "3d". */
export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 60) return "just now";
  return formatDistanceToNowStrict(d)
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y")
    .replace(/ seconds?/, "s");
}

export type ThreadBucket = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";

/** Which sticky date header a thread belongs under, by updated_at. */
export function threadBucket(iso: string | null | undefined): ThreadBucket {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (isAfter(d, subDays(new Date(), 7))) return "Previous 7 days";
  return "Earlier";
}

export const THREAD_BUCKET_ORDER: ThreadBucket[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Earlier",
];
