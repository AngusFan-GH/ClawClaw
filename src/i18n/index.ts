import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/common.json';
import zh from './locales/zh/common.json';
import ja from './locales/ja/common.json';

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    zh: { common: zh },
    ja: { common: ja },
  },
  lng: localStorage.getItem('language') || 'zh',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export const SUPPORTED_LANGUAGES = [
  { code: 'zh', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export default i18n;
