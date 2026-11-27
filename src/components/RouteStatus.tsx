import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RouteStatusProps {
  message?: string;
  error?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
}

export const RouteStatus = ({ message = 'Loading your workspace…', error, onRetry, onSignOut }: RouteStatusProps) => (
  <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground" role={error ? 'alert' : 'status'}>
    <div className="max-w-md space-y-4 text-center">
      {!error && <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />}
      <p>{error || message}</p>
      {error && <div className="flex justify-center gap-3">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        {onSignOut && <Button variant="outline" onClick={onSignOut}>Sign out</Button>}
      </div>}
    </div>
  </div>
);
