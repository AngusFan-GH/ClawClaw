/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows/Linux: icon + "ClawClaw" on left, minimize/maximize/close on right.
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import logoSvg from '@/assets/logo.svg';
import { invokeIpc } from '@/lib/api-client';

const isMac = window.electron?.platform === 'darwin';

export function TitleBar() {
  if (isMac) {
    // macOS: just a drag region, traffic lights are native
    return <div className="drag-region h-11 shrink-0 border-b border-border/70 bg-background/85 backdrop-blur-xl" />;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-border/70 bg-background/85 backdrop-blur-xl">
      {/* Left: Icon + App Name */}
      <div className="no-drag flex items-center gap-2 pl-3">
        <img src={logoSvg} alt="ClawClaw" className="h-5 w-auto" />
        <span className="select-none text-xs font-medium text-foreground/70">ClawClaw</span>
      </div>

      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-foreground/60 transition-colors hover:bg-red-500 hover:text-white"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
