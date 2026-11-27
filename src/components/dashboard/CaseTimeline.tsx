import {
  Clock3,
  Files,
  FileCheck2,
  Search,
  CircleCheck,
  MessageSquare,
  Wallet,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
interface TimelineEvent {
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  created_at: string;
}
const eventIcon = (type: string) =>
  /document/.test(type)
    ? FileCheck2
    : /complet|closed/.test(type)
      ? CircleCheck
      : /recovery|balance|funds/.test(type)
        ? Wallet
        : /review|investigation/.test(type)
          ? Search
          : /message/.test(type)
            ? MessageSquare
            : Files;
export const CaseTimeline = ({
  events,
  caseNumber,
}: {
  events: TimelineEvent[];
  caseNumber: string | null;
}) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return (
    <section className="portal-timeline">
      <header>
        <div>
          <p className="portal-overline">{copy("timeline")}</p>
          <h2>{t("caseTimeline.title")}</h2>
        </div>
        <Clock3 size={20} />
      </header>
      {!sorted.length ? (
        <div className="portal-empty-state">
          <Files />
          <h3>{t("caseTimeline.journeyBegins")}</h3>
          <p>{t("caseTimeline.onceReviewed")}</p>
        </div>
      ) : (
        <ol>
          {sorted.map((event, index) => {
            const Icon = eventIcon(event.event_type);
            return (
              <li key={event.id}>
                <div className="portal-timeline-track">
                  <span>
                    <Icon size={18} />
                  </span>
                </div>
                <article>
                  <div className="portal-timeline-meta">
                    {index === 0 && (
                      <span>{t("caseTimeline.latestUpdate")}</span>
                    )}
                    <time dateTime={event.created_at}>
                      {format(new Date(event.created_at), "dd MMM yyyy")}
                    </time>
                  </div>
                  <h3>{event.title}</h3>
                  {event.description && <p>{event.description}</p>}
                  <small>
                    {formatDistanceToNow(new Date(event.created_at), {
                      addSuffix: true,
                    })}
                  </small>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      {caseNumber && (
        <footer>
          <Files size={14} />
          <span>{t("caseTimeline.caseNumber")}</span>
          <strong>{caseNumber}</strong>
        </footer>
      )}
    </section>
  );
};
