import { AlertCircle, Inbox } from 'lucide-react';
import { LoadingIcon } from '@/components/common/LoadingSpinner';

interface FeedbackStateProps {
  state: 'loading' | 'empty' | 'error';
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function FeedbackState({ state, title, description, action }: FeedbackStateProps) {
  const icon = state === 'loading'
    ? <LoadingIcon className="h-8 w-8 text-primary" />
    : state === 'error'
      ? <AlertCircle className="h-8 w-8 text-destructive" />
      : <Inbox className="h-8 w-8 text-muted-foreground" />;

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-3">{icon}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
