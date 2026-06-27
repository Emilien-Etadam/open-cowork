import { useEffect } from 'react';

const HLJS_THEME_LINK_ID = 'hljs-theme-stylesheet';

const HLJS_THEME_LOADERS: Record<'dark' | 'light', () => Promise<{ default: string }>> = {
  dark: () => import('highlight.js/styles/vs2015.min.css?url'),
  light: () => import('highlight.js/styles/github.min.css?url'),
};

export function useHighlightTheme(effectiveTheme: 'dark' | 'light'): void {
  useEffect(() => {
    const loadTheme = HLJS_THEME_LOADERS[effectiveTheme];
    if (!loadTheme) {
      return;
    }

    let cancelled = false;

    loadTheme()
      .then((module) => {
        if (cancelled) {
          return;
        }

        let link = document.getElementById(HLJS_THEME_LINK_ID) as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.id = HLJS_THEME_LINK_ID;
          link.rel = 'stylesheet';
          document.head.appendChild(link);
        }
        link.href = module.default;
      })
      .catch((error) => {
        console.error('[useHighlightTheme] Failed to load highlight.js theme:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveTheme]);
}
