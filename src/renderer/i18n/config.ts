import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';
import esTranslations from './locales/es.json';
import frTranslations from './locales/fr.json';
import deTranslations from './locales/de.json';
import itTranslations from './locales/it.json';
import ukTranslations from './locales/uk.json';
import plTranslations from './locales/pl.json';
import svTranslations from './locales/sv.json';
import noTranslations from './locales/no.json';
import nlTranslations from './locales/nl.json';
import roTranslations from './locales/ro.json';

const initPromise = i18n
  .use(LanguageDetector) // 自动检测浏览器语言
  .use(initReactI18next) // 初始化 react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
      es: {
        translation: esTranslations,
      },
      fr: {
        translation: frTranslations,
      },
      de: {
        translation: deTranslations,
      },
      it: {
        translation: itTranslations,
      },
      uk: {
        translation: ukTranslations,
      },
      pl: {
        translation: plTranslations,
      },
      sv: {
        translation: svTranslations,
      },
      no: {
        translation: noTranslations,
      },
      nl: {
        translation: nlTranslations,
      },
      ro: {
        translation: roTranslations,
      },
    },
    // 默认语言；挪威语 nb/nn 回退到 no
    fallbackLng: { nb: ['no'], nn: ['no'], default: ['en'] },
    supportedLngs: ['en', 'zh', 'es', 'fr', 'de', 'it', 'uk', 'pl', 'sv', 'no', 'nl', 'ro'], // 支持的语言
    nonExplicitSupportedLngs: true, // 接受区域变体，例如 es-ES → es、zh-CN → zh
    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },
    pluralSeparator: '_', // 复数分隔符
    contextSeparator: '_', // 上下文分隔符
    detection: {
      order: ['localStorage', 'navigator'], // 先检查 localStorage，再检查浏览器语言
      caches: ['localStorage'], // 将语言选择保存到 localStorage
      lookupLocalStorage: 'i18nextLng', // localStorage key
    },
  });

// 将渲染进程的语言镜像到主进程配置，使后端字符串（错误、对话框）使用同一语言。
// Mirror the renderer language into the main-process config so backend-produced
// strings (errors, dialogs, the default config-set name) match the UI. Fires for
// the initially detected language and whenever the user switches.
let lastSyncedLanguage: string | undefined;
function syncBackendLanguage(lng?: string): void {
  if (!lng || lng === lastSyncedLanguage) return;
  lastSyncedLanguage = lng;
  try {
    void window.electronAPI?.config?.save?.({ uiLanguage: lng });
  } catch {
    /* ignore: browser/dev mode without electronAPI */
  }
}

i18n.on('languageChanged', syncBackendLanguage);
void initPromise.then(() => syncBackendLanguage(i18n.language));

export default i18n;
