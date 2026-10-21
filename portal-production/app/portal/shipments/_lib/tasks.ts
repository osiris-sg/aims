// "My tasks today" counts (round O): the reminders due now and in the next 3
// days, split into overdue (due date before today), due today and upcoming.
// Shared by the bell, the Orders list's "Tasks (n)" button and Home.

export interface TaskLike {
  dueAt: string;
  status: string;
}

export interface TaskCounts {
  total: number;
  overdue: number;
  dueToday: number;
  upcoming: number;
}

/** Today as YYYY-MM-DD in Tokyo (the trade day). */
export const tradeTodayYmd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const isOverdue = (t: TaskLike, today: string) => t.dueAt.slice(0, 10) < today;

export function taskCounts(tasks: TaskLike[] | undefined, today: string): TaskCounts {
  const out: TaskCounts = { total: 0, overdue: 0, dueToday: 0, upcoming: 0 };
  for (const t of tasks ?? []) {
    out.total++;
    const d = t.dueAt.slice(0, 10);
    if (d < today) out.overdue++;
    else if (d === today) out.dueToday++;
    else out.upcoming++;
  }
  return out;
}

/** The bell's badge: unread notifications plus the tasks that are due (today or overdue) and not already counted as an unread notification. */
export function bellBadge(unread: number, tasks: TaskLike[] | undefined, today: string, duplicatedUnread: number): number {
  const due = (tasks ?? []).filter((t) => t.dueAt.slice(0, 10) <= today).length;
  return Math.max(0, unread - duplicatedUnread) + due;
}
