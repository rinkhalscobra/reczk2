import { Files, Check, Search, CircleCheck, CircleAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { type RecoveryInvestigationData } from "./RecoveryInvestigationPanel";

interface CaseStatusCardProps extends RecoveryInvestigationData {
  caseNumber: string | null;
  status: string | null;
  casePhase?: string | null;
}
export const CaseStatusCard = ({
  caseNumber,
  status,
  casePhase,
}: CaseStatusCardProps) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  const current =
    casePhase === "completed"
      ? 2
      : !casePhase || casePhase === "submitted"
        ? 0
        : 1;
  const stages = [
    {
      name: t("caseStatus.caseFiled"),
      description: t("caseStatus.caseSubmitted"),
      icon: Files,
    },
    {
      name: t("caseStatus.underReview"),
      description: t("caseStatus.reviewingDocs"),
      icon: Search,
    },
    {
      name: t("caseStatus.completed"),
      description: t("caseStatus.fundsRecovered"),
      icon: CircleCheck,
    },
  ];
  const percent = Math.round(((current + 1) / stages.length) * 100);
  return (
    <section className="portal-case-status">
      <div className="portal-case-status-top">
        <div>
          <p className="portal-overline">{copy("caseFile")}</p>
          <h2>{t("caseStatus.caseProgress")}</h2>
        </div>
        {status === "suspended" ? (
          <CircleAlert size={21} className="text-destructive" />
        ) : (
          <Files size={21} className="text-primary" />
        )}
      </div>
      <div className="portal-case-reference">
        <span>{t("caseStatus.yourCaseNumber")}</span>
        <strong>{caseNumber || t("caseStatus.pendingAssignment")}</strong>
      </div>
      {status === "suspended" && (
        <p className="mb-4 text-sm text-destructive">
          {t("caseStatus.requiresAttention")}
        </p>
      )}
      <div className="portal-progress-label">
        <span>{t("caseStatus.overallProgress")}</span>
        <span>{percent}%</span>
      </div>
      <Progress value={percent} className="h-1.5" />
      <ol className="portal-stage-list">
        {stages.map((stage, index) => (
          <li
            key={stage.name}
            className={`portal-stage${index === current ? " is-current" : index < current ? " is-complete" : ""}`}
            aria-current={index === current ? "step" : undefined}
          >
            <span className="portal-stage-icon">
              {index < current ? <Check size={15} /> : <stage.icon size={14} />}
            </span>
            <div>
              <h3>{stage.name}</h3>
              {index === current && <p>{stage.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};
