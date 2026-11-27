import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import '@/styles/showcase.css';
import '@/styles/public-site.css';

/** Minimal portal shell. Public-site navigation and corporate branding are intentionally omitted. */
export const PublicLayout = ({ children, showHeader = true }: { children: ReactNode; showHeader?: boolean }) => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return (
    <div className="public-site showcase-root relative min-h-screen text-foreground">
      {showHeader && (
        <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur-2xl">
          <div className="public-gutter flex h-16 items-center sm:h-20">
            <Link to="/auth" className="font-serif text-xl tracking-[-0.02em] text-foreground sm:text-2xl">
              User Portal
            </Link>
          </div>
        </header>
      )}
      <main id="public-main">{children}</main>
    </div>
  );
};

export const PublicPageHeader = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) => (
  <div className="public-gutter pb-10 pt-28 sm:pb-14 sm:pt-36">
    <p className="public-eyebrow">{eyebrow}</p>
    <div className="mt-6 grid gap-7 border-b border-white/10 pb-10 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-14">
      <h1 className="public-page-title">{title}</h1>
      {description && <p className="public-description">{description}</p>}
    </div>
  </div>
);

export const PublicSectionHeading = ({
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
  <div className="mb-7 grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-10">
    <div>
      <p className="public-eyebrow">{eyebrow}</p>
      <h2 className="public-section-title mt-3">{title}</h2>
    </div>
    {(description || action) && (
      <div>
        {description && <p className="public-description">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    )}
  </div>
);

export const PublicTextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link
    to={to}
    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-foreground"
  >
    {children}
    <ArrowRight className="h-4 w-4" aria-hidden="true" />
  </Link>
);
