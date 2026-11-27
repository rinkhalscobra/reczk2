import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { useCustomerData } from "@/hooks/useCustomerData";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCheck, MessagesSquare } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useClientCopy } from "@/i18n/clientExperience";

const MessagesPage = () => {
  const { user } = useAuth();
  const { profile, isLoading } = useCustomerData();
  const { t } = useLanguage();
  const copy = useClientCopy();
  const [conversationRecipientId, setConversationRecipientId] = useState<
    string | null
  >(null);
  const [isResolvingConversation, setIsResolvingConversation] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setConversationRecipientId(null);
      setIsResolvingConversation(false);
      return;
    }

    let active = true;
    setIsResolvingConversation(true);

    const resolveRecipient = async () => {
      // CRM messages use the customer's ID as the conversation ID. The latest
      // staff sender is the correct reply target even when assigned_to is empty.
      const { data, error } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("conversation_id", user.id)
        .neq("sender_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!active) return;
      if (error) console.error("Error resolving conversation contact:", error);
      setConversationRecipientId(
        data?.sender_id || profile?.assigned_to || null,
      );
      setIsResolvingConversation(false);
    };

    void resolveRecipient();

    const channel = supabase
      .channel(`client-conversation-contact-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${user.id}`,
        },
        (payload) => {
          const message = payload.new as {
            sender_id: string;
            recipient_id: string;
          };
          if (
            message.sender_id !== user.id &&
            message.recipient_id === user.id
          ) {
            setConversationRecipientId(message.sender_id);
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.assigned_to]);

  if (isLoading || isResolvingConversation) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[500px]" />
        </div>
      </DashboardLayout>
    );
  }

  // Use the customer's own ID as conversation ID for simplicity
  // In a real app, you might have a separate conversations table
  const conversationId = user?.id || "";
  const recipientId = conversationRecipientId || profile?.assigned_to || "";

  return (
    <DashboardLayout>
      <div className="portal-page-stack">
        <DashboardPageHeader
          eyebrow={copy("workspace")}
          title={t("messages.title")}
          description={t("messages.subtitle")}
        />
        <div className="portal-messages-layout">
          <aside className="portal-conversation-info">
            <span className="portal-support-icon">
              <MessagesSquare size={24} />
            </span>
            <h2>{copy("support")}</h2>
            <p>{copy("contactHint")}</p>
            {profile?.case_number && (
              <dl>
                <dt>{copy("caseReference")}</dt>
                <dd>{profile.case_number}</dd>
              </dl>
            )}
          </aside>
          <div className="min-w-0">
            {!recipientId ? (
              <section className="portal-surface portal-empty-state">
                <UserCheck />
                <h2>{t("messages.noAgentAssigned")}</h2>
                <p>{t("messages.noAgentDesc")}</p>
              </section>
            ) : (
              <ChatWindow
                conversationId={conversationId}
                recipientId={recipientId}
                recipientName={t("messages.caseSpecialist")}
                className="h-[min(680px,calc(100dvh-240px))] min-h-[430px]"
              />
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
export default MessagesPage;
