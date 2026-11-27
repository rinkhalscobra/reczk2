import { Bell, CheckCircle, Info, TriangleAlert, CircleX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerData } from "@/hooks/useCustomerData";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
const icons = {
  success: CheckCircle,
  warning: TriangleAlert,
  error: CircleX,
  info: Info,
};
const NotificationsPage = () => {
  const { notifications, isLoading, markNotificationRead } = useCustomerData();
  const { t } = useLanguage();
  const copy = useClientCopy();
  const unread = notifications.filter((n) => !n.is_read);
  const earlier = notifications.filter((n) => n.is_read);
  return (
    <DashboardLayout>
      <div className="portal-page-stack">
        <DashboardPageHeader
          eyebrow={copy("latest")}
          title={t("notifications.title")}
          description={t("notifications.subtitle")}
          action={
            unread.length > 0 ? (
              <Button
                variant="outline"
                onClick={() =>
                  unread.forEach((n) => void markNotificationRead(n.id))
                }
              >
                {t("notifications.markAllRead")}
              </Button>
            ) : undefined
          }
        />
        {isLoading ? (
          <Skeleton className="h-80" />
        ) : !notifications.length ? (
          <section className="portal-surface portal-empty-state">
            <Bell />
            <h2>{t("notifications.noNotifications")}</h2>
            <p>{t("notifications.noNotificationsDescription")}</p>
          </section>
        ) : (
          [unread, earlier].map(
            (group, index) =>
              group.length > 0 && (
                <section key={index}>
                  <h2 className="portal-overline mb-4">
                    {index === 0
                      ? t("notifications.unread")
                      : t("notifications.earlier")}{" "}
                    · {group.length}
                  </h2>
                  <div className="portal-notification-list">
                    {group.map((n) => {
                      const Icon = icons[n.type as keyof typeof icons] || Info;
                      const content = (
                        <>
                          <span className="portal-empty-symbol">
                            <Icon size={22} />
                          </span>
                          <div className="portal-notification-body">
                            <h3>{n.title}</h3>
                            {n.message && <p>{n.message}</p>}
                            <time dateTime={n.created_at}>
                              {formatDistanceToNow(new Date(n.created_at), {
                                addSuffix: true,
                              })}
                            </time>
                          </div>
                          {!n.is_read && (
                            <span
                              className="portal-notification-marker"
                              aria-label={t("notifications.unread")}
                            />
                          )}
                        </>
                      );
                      return n.is_read ? (
                        <article key={n.id} className="portal-notification">
                          {content}
                        </article>
                      ) : (
                        <button
                          key={n.id}
                          type="button"
                          className="portal-notification is-unread"
                          onClick={() => void markNotificationRead(n.id)}
                        >
                          {content}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ),
          )
        )}
      </div>
    </DashboardLayout>
  );
};
export default NotificationsPage;
