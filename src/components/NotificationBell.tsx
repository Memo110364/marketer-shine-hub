import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useNotifications,
  useMarkNotificationRead,
  type AppNotification,
} from "@/lib/notifications";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString("ar-EG");
}

/**
 * Header bell: unread count badge plus the list of what is waiting, each row
 * linking straight to the page where the pending edit can be approved.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { items, unreadCount, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();

  function open(n: AppNotification) {
    if (!n.read_at) markRead.mutate([n.id]);
    if (n.link_path) navigate({ to: n.link_path as never });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="الإشعارات">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">الإشعارات</div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(items.filter((n) => !n.read_at).map((n) => n.id))}
            >
              <Check className="h-3 w-3 ml-1" /> تحديد الكل كمقروء
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[360px]">
          {isLoading ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">لا توجد إشعارات</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`w-full text-right px-3 py-2.5 hover:bg-muted/60 transition-colors ${n.read_at ? "" : "bg-primary/5"}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read_at && (
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug">{n.title}</div>
                        {n.body && (
                          <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line line-clamp-3">
                            {n.body}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {timeAgo(n.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
