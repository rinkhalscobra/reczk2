import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface WindowChromeProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * macOS-style window frame used by authenticated app shells.
 * Purely presentational: traffic-light dots on the left, centered title.
 */
export const WindowChrome = ({ title = 'User Portal', children, className }: WindowChromeProps) => {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-border bg-card',
        'shadow-card',
        'overflow-hidden',
        className,
      )}
    >
      {/* Title bar */}
      <div className="relative flex items-center h-9 px-4 border-b border-border bg-muted/50">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-muted-foreground/55" />
          <span className="h-3 w-3 rounded-full bg-muted-foreground/35" />
          <span className="h-3 w-3 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="absolute inset-x-0 flex justify-center pointer-events-none">
          <span className="max-w-[60%] truncate text-[12px] font-medium text-muted-foreground tracking-tight">{title}</span>
        </div>
      </div>
      {children}
    </div>
  );
};

export default WindowChrome;
