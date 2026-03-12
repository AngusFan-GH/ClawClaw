import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PageHeader({
  title,
  subtitle,
  description,
  actions,
  className,
  contentClassName,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-5 shrink-0', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className={cn('max-w-3xl', contentClassName)}>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-muted-foreground md:text-[15px]">{subtitle}</p> : null}
          {description ? <p className="mt-2 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
