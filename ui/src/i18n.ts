import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./i18n/en.json";
import ko from "./i18n/ko.json";

void i18next.use(LanguageDetector).use(initReactI18next).init({
  fallbackLng: "en",
  supportedLngs: ["en", "ko"],
  interpolation: { escapeValue: false },
  resources: { en: { translation: en }, ko: { translation: ko } },
});

export const i18n = i18next;
