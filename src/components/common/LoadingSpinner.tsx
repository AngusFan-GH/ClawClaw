import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface LoadingIconProps {
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function LoadingIcon({ className }: LoadingIconProps) {
  return (
    <span className={cn('clawx-loading-icon', className)} aria-hidden="true">
      <span className="clawx-loading-icon__dot" />
      <span className="clawx-loading-icon__dot" />
      <span className="clawx-loading-icon__dot" />
    </span>
  );
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <LoadingIcon className={cn('text-primary', sizeClasses[size])} />
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
