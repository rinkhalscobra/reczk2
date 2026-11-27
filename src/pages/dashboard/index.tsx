import { useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessagesSquare, Files } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { CaseStatusCard } from "@/components/dashboard/CaseStatusCard";
import { RecoveryInvestigationPanel } from "@/components/dashboard/RecoveryInvestigationPanel";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { RecoveryFundsPanel } from "@/components/dashboard/RecoveryFundsPanel";
import { useCustomerData } from "@/hooks/useCustomerData";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { roleHome } from "@/lib/roles";

const DashboardIndex = () => {
  const navigate = useNavigate();
  const { role, isLoading: roleLoading, isStaff } = useUserRole();
  const {
    balances,
    cryptoBalances,
    cryptoBalanceAdjustments,
    profile,
    transactions,
    isLoading,
    refetch,
  } = useCustomerData();
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useClientCopy();
  useEffect(() => {
    if (!roleLoading && isStaff && role)
      navigate(roleHome[role], { replace: true });
  }, [role, roleLoading, isStaff, navigate]);
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
  if (isLoading || roleLoading)
    return (
      <DashboardLayout>
        <div className="portal-page-stack">
          <Skeleton className="h-20 w-2/3" />
          <Skeleton className="h-80" />
        </div>
      </DashboardLayout>
    );
  return (
    <DashboardLayout>
      <PullToRefresh onRefresh={refresh}>
        <div className="portal-overview">
          <header className="portal-overview-header">
            <div>
              <p className="portal-overline">{copy("overviewLabel")}</p>
              <h1>
                {t("dashboard.welcomeBack")}
                {profile?.first_name ? ", " : ""}
                <span>{profile?.first_name || ""}</span>
                <span className="portal-title-dot">.</span>
              </h1>
              <p>{copy("overviewHint")}</p>
            </div>
            <Link
              className="portal-button portal-button-secondary"
              to="/dashboard/case"
            >
              <Files size={17} />
              {t("nav.myCase")}
            </Link>
          </header>
          <div className="portal-overview-grid">
            <BalanceCard
              balances={balances}
              cryptoBalances={cryptoBalances}
              cryptoBalanceAdjustments={cryptoBalanceAdjustments}
            />
            <CaseStatusCard
              caseNumber={profile?.case_number || null}
              status={profile?.status || null}
              casePhase={profile?.case_phase || null}
              searchStartedAt={profile?.recovery_search_started_at}
              searchDurationMinutes={profile?.recovery_search_duration_minutes}
              searchScope={profile?.recovery_search_scope}
              resultType={profile?.recovery_result_type}
              resultDetails={profile?.recovery_result_details}
              completedAt={profile?.recovery_completed_at}
            />
          </div>
          <RecoveryInvestigationPanel
            phase={profile?.case_phase}
            searchStartedAt={profile?.recovery_search_started_at}
            searchDurationMinutes={profile?.recovery_search_duration_minutes}
            searchScope={profile?.recovery_search_scope}
            resultType={profile?.recovery_result_type}
            resultDetails={profile?.recovery_result_details}
            completedAt={profile?.recovery_completed_at}
          />
          <RecoveryFundsPanel
            customerId={user?.id}
            casePhase={profile?.case_phase}
          />
          <RecentActivityCard transactions={transactions} />
          <section className="portal-support">
            <span className="portal-support-icon">
              <MessagesSquare size={25} strokeWidth={1.5} />
            </span>
            <div>
              <h2>{copy("contact")}</h2>
              <p>{copy("contactHint")}</p>
            </div>
            <Link
              to="/dashboard/messages"
              className="portal-button portal-button-secondary"
            >
              {t("nav.messages")}
            </Link>
          </section>
        </div>
      </PullToRefresh>
    </DashboardLayout>
  );
};
export default DashboardIndex;
