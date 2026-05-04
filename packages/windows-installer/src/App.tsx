import { useEffect, useMemo, useState } from 'react';
import {
  defaultInstallOptions,
  defaultUninstallOptions,
  type InstallOptions,
  type UninstallOptions,
} from './installer-model';
import type { InstallerMode, InstallerPlan } from './core/types';
import type { InstallerPlanRequest, InstallerProgressEvent } from './shared/ipc';
import {
  dataWarningCopy,
  primaryInstallCopy,
  productName,
  productSubtitle,
  uninstallCopy,
  upgradeCopy,
} from './installer-copy';

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={disabled ? 'toggle disabled' : 'toggle'}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function InstallPanel({
  mode,
  options,
  setOptions,
}: {
  mode: InstallerMode;
  options: InstallOptions;
  setOptions: (next: InstallOptions) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{mode === 'upgrade' ? 'Upgrade ClawClaw' : 'Install ClawClaw'}</h2>
          <p>{mode === 'upgrade' ? upgradeCopy : primaryInstallCopy}</p>
        </div>
        <button className="text-button" type="button" onClick={() => setCustomOpen((value) => !value)}>
          {customOpen ? 'Hide custom options' : 'Custom install'}
        </button>
      </div>

      <div className="install-dir">
        <span>Install location</span>
        <strong>{options.installDir}</strong>
      </div>

      {customOpen && (
        <div className="custom-options">
          <label className="field">
            <span>Install directory</span>
            <input
              value={options.installDir}
              onChange={(event) => setOptions({ ...options, installDir: event.currentTarget.value })}
            />
          </label>
          <Toggle
            label="Create desktop shortcut"
            description="Add a shortcut for the current Windows user."
            checked={options.createDesktopShortcut}
            onChange={(checked) => setOptions({ ...options, createDesktopShortcut: checked })}
          />
          <Toggle
            label="Launch at startup"
            description="Start ClawClaw automatically when you sign in."
            checked={options.launchAtStartup}
            onChange={(checked) => setOptions({ ...options, launchAtStartup: checked })}
          />
          <Toggle
            label="Install OpenClaw CLI"
            description="Add the bundled OpenClaw command to your user PATH."
            checked={options.installCliPath}
            onChange={(checked) => setOptions({ ...options, installCliPath: checked })}
          />
        </div>
      )}
    </section>
  );
}

function UninstallPanel({
  options,
  setOptions,
}: {
  options: UninstallOptions;
  setOptions: (next: UninstallOptions) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Uninstall ClawClaw</h2>
          <p>{uninstallCopy}</p>
        </div>
      </div>
      <div className="warning">
        <strong>Data deletion is optional.</strong>
        <span>{dataWarningCopy}</span>
      </div>
      <div className="custom-options">
        <Toggle
          label="Remove application"
          description="Delete ClawClaw program files, shortcuts, and CLI PATH entries."
          checked={options.removeApp}
          disabled
          onChange={() => undefined}
        />
        <Toggle
          label="Delete ClawClaw settings"
          description="Remove app settings and local ClawClaw data."
          checked={options.removeClawClawData}
          onChange={(checked) => setOptions({ ...options, removeClawClawData: checked })}
        />
        <Toggle
          label="Delete OpenClaw data"
          description="Remove ~/.openclaw, including agents, channels, skills, credentials, and sessions."
          checked={options.removeOpenClawData}
          onChange={(checked) => setOptions({ ...options, removeOpenClawData: checked })}
        />
        <Toggle
          label="Delete logs and cache"
          description="Remove local logs, temporary files, and runtime cache."
          checked={options.removeLogsAndCache}
          onChange={(checked) => setOptions({ ...options, removeLogsAndCache: checked })}
        />
      </div>
    </section>
  );
}

type UiStepStatus = 'pending' | 'active' | 'done' | 'error';

function ProgressPanel({
  plan,
  statuses,
}: {
  plan: InstallerPlan;
  statuses: Record<string, UiStepStatus>;
}) {
  return (
    <section className="panel progress-panel">
      <div className="panel-heading">
        <div>
          <h2>{plan.title}</h2>
          <p>{plan.summary}</p>
        </div>
      </div>
      <div className="steps">
        {plan.steps.map((step) => {
          const status = statuses[step.id] ?? 'pending';
          return (
          <div className={`step ${status} ${step.destructive ? 'destructive' : ''}`} key={step.id}>
            <span className="step-dot" />
            <div>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

export function App() {
  const [mode, setMode] = useState<InstallerMode>('install');
  const [installOptions, setInstallOptions] = useState(defaultInstallOptions);
  const [uninstallOptions, setUninstallOptions] = useState(defaultUninstallOptions);
  const [arch, setArch] = useState('x64');
  const [legacyVersion, setLegacyVersion] = useState<string | undefined>();
  const [detectedExistingInstall, setDetectedExistingInstall] = useState(false);
  const [stepStatuses, setStepStatuses] = useState<Record<string, UiStepStatus>>({});
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(
    window.installer ? null : 'Installer bridge is unavailable. Launch this UI from ClawClaw-Setup.exe.',
  );
  const [plan, setPlan] = useState<InstallerPlan | null>(null);

  const primaryAction = useMemo(() => {
    if (mode === 'upgrade') return 'Upgrade';
    if (mode === 'uninstall') return 'Uninstall';
    return 'Install';
  }, [mode]);

  const request = useMemo<InstallerPlanRequest>(() => ({
      mode,
      installDir: installOptions.installDir,
      arch,
      legacyVersion,
      createDesktopShortcut: installOptions.createDesktopShortcut,
      launchAtStartup: installOptions.launchAtStartup,
      installCliPath: installOptions.installCliPath,
      removeClawClawData: uninstallOptions.removeClawClawData,
      removeOpenClawData: uninstallOptions.removeOpenClawData,
      removeLogsAndCache: uninstallOptions.removeLogsAndCache,
  }), [arch, installOptions, legacyVersion, mode, uninstallOptions]);

  useEffect(() => {
    let cancelled = false;
    if (!window.installer) {
      setPlan(null);
      return () => {
        cancelled = true;
      };
    }

    void window.installer.getInitialState().then((state) => {
      if (cancelled) return;
      setMode(state.mode);
      setArch(state.arch);
      setLegacyVersion(state.legacyVersion);
      setDetectedExistingInstall(state.detectedExistingInstall);
      setInstallOptions((current) => ({ ...current, installDir: state.installDir }));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!window.installer) {
      setPlan(null);
      return () => {
        cancelled = true;
      };
    }

    void window.installer.getPlan(request).then((response) => {
      if (cancelled) return;
      if (response.ok && response.plan) {
        setPlan(response.plan);
        setStatusMessage(null);
      } else {
        setPlan(null);
        setStatusMessage(response.error ?? 'Unable to build installer plan.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!plan) {
      setStepStatuses({});
      return;
    }
    setStepStatuses(Object.fromEntries(plan.steps.map((step) => [step.id, 'pending' as const])));
    setStatusMessage(null);
  }, [plan]);

  useEffect(() => {
    if (!window.installer) return undefined;
    return window.installer.onProgress((event) => {
      handleProgressEvent(event);
    });
  }, []);

  const handleProgressEvent = (event: InstallerProgressEvent) => {
    if (event.message) {
      setStatusMessage(event.message);
    }
    if (!event.stepId) {
      if (event.type === 'done') setRunning(false);
      return;
    }
    setStepStatuses((current) => {
      const next = { ...current };
      if (event.type === 'step:start') next[event.stepId!] = 'active';
      if (event.type === 'step:done') next[event.stepId!] = 'done';
      if (event.type === 'step:error') next[event.stepId!] = 'error';
      return next;
    });
    if (event.type === 'step:error') {
      setRunning(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (!window.installer || !plan) {
      setStatusMessage('Installer bridge is unavailable. Launch this UI from ClawClaw-Setup.exe.');
      return;
    }
    setRunning(true);
    setStatusMessage('Starting...');
    setStepStatuses(Object.fromEntries(plan.steps.map((step) => [step.id, 'pending' as const])));

    const response = await window.installer.start({
      ...request,
      execute: window.installer.platform === 'win32',
    });
    if (!response.ok) {
      setStatusMessage(response.error ?? 'Installer failed.');
      setRunning(false);
      return;
    }
    setStatusMessage(window.installer.platform === 'win32'
      ? 'Completed.'
      : 'Dry run completed. Real execution is Windows-only.');
    setRunning(false);
  };

  return (
    <main className="shell">
      <aside className="brand">
        <div className="brand-mark">C</div>
        <div>
          <p className="eyebrow">Windows Setup</p>
          <h1>{productName}</h1>
          <p className="subtitle">{productSubtitle}</p>
        </div>
        <div className="detected-mode">
          <span>{mode === 'upgrade' ? 'Upgrade detected' : mode === 'uninstall' ? 'Maintenance mode' : 'Fresh install'}</span>
          {detectedExistingInstall && legacyVersion && <strong>Installed version {legacyVersion}</strong>}
        </div>
        <div className="brand-footer">
          <strong>Data is preserved by default</strong>
          <span>Additional data removal is only available in maintenance mode and requires explicit selection.</span>
        </div>
      </aside>

      <section className="content">
        {mode === 'uninstall' ? (
          <UninstallPanel options={uninstallOptions} setOptions={setUninstallOptions} />
        ) : (
          <InstallPanel mode={mode} options={installOptions} setOptions={setInstallOptions} />
        )}
        {plan ? (
          <ProgressPanel plan={plan} statuses={stepStatuses} />
        ) : (
          <section className="panel progress-panel">
            <div className="panel-heading">
              <div>
                <h2>Installer unavailable</h2>
                <p>This interface must be launched by the ClawClaw Windows installer shell.</p>
              </div>
            </div>
          </section>
        )}
        {statusMessage && <div className="status-line">{statusMessage}</div>}
        <footer className="actions">
          <button
            className={mode === 'uninstall' ? 'danger primary' : 'primary'}
            type="button"
            disabled={running || !plan || !window.installer}
            onClick={() => void handlePrimaryAction()}
          >
            {running ? 'Working...' : primaryAction}
          </button>
        </footer>
      </section>
    </main>
  );
}
