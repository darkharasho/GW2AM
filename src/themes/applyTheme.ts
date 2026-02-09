import { getThemeById } from './themes';

export function applyTheme(themeId?: string): string {
  const theme = getThemeById(themeId);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  Object.entries(theme.vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  return theme.id;
}
