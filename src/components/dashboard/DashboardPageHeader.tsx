import type { ReactNode } from "react";

export const DashboardPageHeader = ({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <header className="portal-page-heading">
    <div>
      <p className="portal-overline">{eyebrow}</p>
      <h1>
        {title}
        <span className="portal-title-dot">.</span>
      </h1>
      {description && <p className="portal-page-description">{description}</p>}
    </div>
    {action && <div className="portal-page-action">{action}</div>}
  </header>
);
