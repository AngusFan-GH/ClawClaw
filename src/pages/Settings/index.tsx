import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { PageHeader } from '../../components/extras';
import { SUPPORTED_LANGUAGES } from '../../i18n';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const version = useQuery(() => api.appVersion().catch(() => '—'), []);
  const readiness = useQuery(() => api.readiness().catch(() => null), []);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system');

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    localStorage.setItem('theme', theme);
  }, [theme]);

  const changeLanguage = (lng: string) => {
    void i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
    void api.settings.set('language', lng);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('settings.title')} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        <section className="max-w-lg">
          <h2 className="text-sm font-semibold">{t('settings.appearance')}</h2>
          <div className="mt-3 grid gap-3">
            <label className="text-xs text-muted-foreground">{t('settings.language')}
              <select value={i18n.language} onChange={(e) => changeLanguage(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">{t('settings.theme')}
              <select value={theme} onChange={(e) => setTheme(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <option value="system">{t('settings.themeSystem')}</option>
                <option value="light">{t('settings.themeLight')}</option>
                <option value="dark">{t('settings.themeDark')}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="max-w-lg">
          <h2 className="text-sm font-semibold">{t('settings.about')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('settings.description')}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('settings.version')}</dt><dd>{version.data}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('providers.title')}</dt><dd>{readiness.data?.providerCount ?? 0}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
