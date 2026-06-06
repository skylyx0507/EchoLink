import { describe, it, expect } from 'vitest';
import { themes, defaultTheme } from './themes';

describe('themes', () => {
  it('has 5 built-in themes', () => {
    expect(Object.keys(themes)).toHaveLength(5);
  });

  it('default theme is "dark"', () => {
    expect(defaultTheme).toBe('dark');
  });

  it('each theme has required color fields', () => {
    const requiredKeys = [
      'primary', 'primaryHover', 'primaryLight',
      'success', 'successLight', 'danger', 'dangerLight',
      'bg', 'bgCard', 'bgInput', 'text', 'textSecondary',
      'textMuted', 'border', 'gradient',
    ];

    for (const [name, theme] of Object.entries(themes)) {
      for (const key of requiredKeys) {
        expect(theme.colors[key as keyof typeof theme.colors], `${name} missing ${key}`).toBeDefined();
      }
    }
  });

  it('dark theme colors are valid hex or rgba', () => {
    const dark = themes.dark;
    expect(dark.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(dark.colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(dark.colors.primaryLight).toMatch(/^rgba\(/);
  });
});
