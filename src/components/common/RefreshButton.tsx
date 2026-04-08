import { RefreshCw } from 'lucide-react';

import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type RefreshButtonMode = 'default' | 'compact' | 'icon';

interface RefreshButtonProps extends Omit<ButtonProps, 'children'> {
  label: string;
  loading?: boolean;
  mode?: RefreshButtonMode;
}

const modeClasses: Record<RefreshButtonMode, string> = {
  default:
    'h-9 rounded-xl border-border/70 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-accent/70 hover:text-foreground',
  compact:
    'h-8 rounded-[12px] border-border/70 bg-transparent px-3.5 text-[12px] font-medium text-foreground/80 shadow-none hover:bg-accent/70 hover:text-foreground',
  icon:
    'h-10 w-10 rounded-[12px] border-border/70 bg-transparent text-muted-foreground shadow-none hover:bg-accent/70 hover:text-foreground',
};

export function RefreshButton({
  label,
  loading = false,
  mode = 'default',
  className,
  disabled,
  title,
  variant,
  ...props
}: RefreshButtonProps) {
  const icon = loading ? <LoadingIcon className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />;

  return (
    <Button
      variant={variant ?? 'outline'}
      size={mode === 'icon' ? 'icon' : undefined}
      disabled={disabled ?? loading}
      title={title ?? label}
      aria-label={label}
      className={cn(modeClasses[mode], className)}
      {...props}
    >
      {mode === 'icon' ? (
        icon
      ) : (
        <>
          <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">
            {icon}
          </span>
          {label}
        </>
      )}
    </Button>
  );
}
