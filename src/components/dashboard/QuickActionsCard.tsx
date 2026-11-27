import { ArrowDownLeft, ArrowUpRight, MessageSquare, FileText, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

export const QuickActionsCard = () => {
  const { t } = useLanguage();
  const actions = [
    { to: '/dashboard/deposit', label: t('balance.deposit'), detail: 'Add funds', icon: ArrowDownLeft, color: '#2f8064', bg: 'rgba(47,128,100,.10)' },
    { to: '/dashboard/withdraw', label: t('balance.withdraw'), detail: 'Request transfer', icon: ArrowUpRight, color: '#8b6529', bg: 'rgba(167,122,50,.10)' },
    { to: '/dashboard/case', label: t('quickActions.myCase'), detail: 'View progress', icon: FileText, color: '#8b6529', bg: 'rgba(167,122,50,.10)' },
    { to: '/dashboard/messages', label: t('nav.messages'), detail: 'Contact your team', icon: MessageSquare, color: '#52708f', bg: 'rgba(82,112,143,.10)' },
  ];

  return (
    <section className="client-panel client-panel-grid grid gap-px sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <Link key={action.to} to={action.to} className="group flex min-w-0 items-center gap-3 bg-card p-4 transition-colors hover:bg-[hsl(var(--accent))] sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ color: action.color, background: action.bg }}>
            <action.icon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{action.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{action.detail}</span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      ))}
    </section>
  );
};
