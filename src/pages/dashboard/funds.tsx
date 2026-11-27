import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { RecoveryFundsPanel } from "@/components/dashboard/RecoveryFundsPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCustomerData } from "@/hooks/useCustomerData";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useClientCopy } from "@/i18n/clientExperience";
import { useLanguage } from "@/contexts/LanguageContext";
import { Files } from "lucide-react";
import { Link } from "react-router-dom";

const RecoveryFundsPage = () => {
  const { user } = useAuth();
  const copy = useClientCopy();
  const { t } = useLanguage();
  const { profile, isLoading } = useCustomerData();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <DashboardPageHeader
          eyebrow={copy("caseFile")}
          title="Located Funds"
          description="Track amounts identified by your investigation and their recovery progress."
        />
        {isLoading ? (
          <Skeleton className="h-80" />
        ) : profile?.case_phase === "completed" ? (
          <RecoveryFundsPanel
            customerId={user?.id}
            casePhase={profile.case_phase}
          />
        ) : (
          <section className="portal-surface portal-empty-state">
            <Files />
            <h2>{t("caseStatus.processingCase")}</h2>
            <p>{copy("caseHint")}</p>
            <Link className="portal-button" to="/dashboard/case">
              {t("nav.myCase")}
            </Link>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
};

export default RecoveryFundsPage;
