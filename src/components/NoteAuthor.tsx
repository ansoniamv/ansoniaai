import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf, type TeamMember } from "@/hooks/useTeamMembers";
import { cn } from "@/lib/utils";

export interface NoteAuthorProps {
  member?: Pick<TeamMember, "full_name" | "avatar_url" | "role"> | null;
  fallbackName?: string | null;
  size?: "sm" | "md";
  showRole?: boolean;
  className?: string;
}

/**
 * Renders the note author as avatar + name (+ optional role).
 * If a team member is linked, uses their headshot; otherwise falls back
 * to the free-text `author` string (typically an email).
 */
export function NoteAuthor({
  member,
  fallbackName,
  size = "sm",
  showRole = true,
  className,
}: NoteAuthorProps) {
  const displayName = member?.full_name ?? fallbackName ?? null;
  if (!displayName) return null;

  const dims = size === "md" ? "h-6 w-6" : "h-5 w-5";
  const nameCls = size === "md" ? "text-sm" : "text-xs";

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <Avatar className={dims}>
        {member?.avatar_url ? (
          <AvatarImage src={member.avatar_url} alt={displayName} />
        ) : null}
        <AvatarFallback className="text-[9px] font-semibold">
          {initialsOf(displayName)}
        </AvatarFallback>
      </Avatar>
      <span className={cn("font-medium text-foreground/90 leading-none", nameCls)}>
        {displayName}
      </span>
      {showRole && member?.role ? (
        <span className="text-[10px] text-muted-foreground leading-none">· {member.role}</span>
      ) : null}
    </div>
  );
}
