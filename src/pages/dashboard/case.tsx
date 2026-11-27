import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { CaseStatusCard } from "@/components/dashboard/CaseStatusCard";
import { RecoveryInvestigationPanel } from "@/components/dashboard/RecoveryInvestigationPanel";
import { CaseTimeline } from "@/components/dashboard/CaseTimeline";
import { RecoveryFundsPanel } from "@/components/dashboard/RecoveryFundsPanel";
import { KycPanel } from "@/components/kyc/KycPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerData } from "@/hooks/useCustomerData";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";

const CasePage = () => {
  const { profile, timeline, isLoading } = useCustomerData();
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useClientCopy();
  return (
    <DashboardLayout>
      <div className="portal-page-stack">
        <DashboardPageHeader
          eyebrow={copy("caseFile")}
          title={t("case.title")}
          description={copy("caseHint")}
        />
        {isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="portal-page-stack">
            <RecoveryInvestigationPanel
              phase={profile?.case_phase}
              searchStartedAt={profile?.recovery_search_started_at}
              searchDurationMinutes={profile?.recovery_search_duration_minutes}
              searchScope={profile?.recovery_search_scope}
              resultType={profile?.recovery_result_type}
              resultDetails={profile?.recovery_result_details}
              completedAt={profile?.recovery_completed_at}
            />
            <div className="portal-case-summary-grid">
              <CaseStatusCard
                caseNumber={profile?.case_number || null}
                status={profile?.status || null}
                casePhase={profile?.case_phase || null}
                searchStartedAt={profile?.recovery_search_started_at}
                searchDurationMinutes={
                  profile?.recovery_search_duration_minutes
                }
                searchScope={profile?.recovery_search_scope}
                resultType={profile?.recovery_result_type}
                resultDetails={profile?.recovery_result_details}
                completedAt={profile?.recovery_completed_at}
              />
              <section className="portal-surface">
                <h2 className="portal-section-title mb-6">{copy("details")}</h2>
                <dl className="portal-profile-list">
                  <div>
                    <dt>{t("case.fullName")}</dt>
                    <dd>
                      {[profile?.first_name, profile?.last_name]
                        .filter(Boolean)
                        .join(" ") || t("case.notProvided")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("case.email")}</dt>
                    <dd>{profile?.email || t("case.notProvided")}</dd>
                  </div>
                  <div>
                    <dt>{t("case.phone")}</dt>
                    <dd>{profile?.phone || t("case.notProvided")}</dd>
                  </div>
                  <div>
                    <dt>{t("case.memberSince")}</dt>
                    <dd>
                      {profile?.created_at
                        ? new Date(profile.created_at).toLocaleDateString()
                        : t("case.notProvided")}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
            <CaseTimeline
              events={timeline}
              caseNumber={profile?.case_number || null}
            />
            {user?.id && (
              <section>
                <p className="portal-overline mb-4">{copy("documents")}</p>
                <KycPanel
                  customerId={user.id}
                  mode="client"
                  initialFirstName={profile?.first_name}
                  initialLastName={profile?.last_name}
                />
              </section>
            )}
            <RecoveryFundsPanel
              customerId={user?.id}
              casePhase={profile?.case_phase}
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};
export default CasePage;
