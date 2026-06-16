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

i18n
  .use(LanguageDetector) // auto-detect the browser/UI language
  .use(initReactI18next) // initialize react-i18next
  .init({
    resources: {
      en: { translation: enTranslations },
      zh: { translation: zhTranslations },
      es: { translation: esTranslations },
      fr: { translation: frTranslations },
      de: { translation: deTranslations },
      it: { translation: itTranslations },
      uk: { translation: ukTranslations },
      pl: { translation: plTranslations },
      sv: { translation: svTranslations },
      no: { translation: noTranslations },
      nl: { translation: nlTranslations },
      ro: { translation: roTranslations },
    },
    fallbackLng: 'en', // default language
    supportedLngs: ['en', 'zh', 'es', 'fr', 'de', 'it', 'uk', 'pl', 'sv', 'no', 'nl', 'ro'],
    interpolation: {
      escapeValue: false, // React already guards against XSS
    },
    pluralSeparator: '_', // plural separator
    contextSeparator: '_', // context separator
    detection: {
      order: ['localStorage', 'navigator'], // check localStorage first, then the browser language
      caches: ['localStorage'], // persist the language choice to localStorage
      lookupLocalStorage: 'i18nextLng', // localStorage key
    },
  });

export default i18n;
