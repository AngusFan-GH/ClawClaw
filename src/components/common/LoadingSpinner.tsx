import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface LoadingIconProps {
  className?: string;
}

interface PageLoaderProps {
  title?: string;
  description?: string;
  className?: string;
  compact?: boolean;
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

export function PageLoader({
  title,
  description,
  className,
  compact = false,
}: PageLoaderProps) {
  return (
    <div className={cn('flex items-center justify-center', compact ? 'py-16 sm:py-20' : 'h-full min-h-[320px]', className)}>
      <div
        className={cn(
          'flex flex-col items-center text-center',
          compact
            ? 'w-full max-w-md rounded-[16px] border border-border/70 bg-card/70 px-6 py-8'
            : 'w-full max-w-sm rounded-[18px] border border-border/70 bg-card/72 px-8 py-10 shadow-[0_14px_32px_rgba(15,23,42,0.05)]'
        )}
      >
        <LoadingSpinner size="lg" />
        {title ? (
          <h3 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h3>
        ) : null}
        {description ? (
          <p className="mt-2 text-[14px] leading-[1.7] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
