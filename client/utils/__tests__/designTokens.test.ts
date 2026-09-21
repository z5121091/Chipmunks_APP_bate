import fs from 'node:fs';
import path from 'node:path';
import { DarkColors, LightColors, ModuleColors } from '../../resources/colors';
import { ModuleColors as ThemeModuleColors, Typography } from '../../constants/theme';

const css = fs
  .readFileSync(path.resolve(__dirname, '../../global.css'), 'utf8')
  .toLowerCase();

const expectCssVariable = (name: string, value: string) => {
  expect(css).toContain(`${name}: ${value.toLowerCase()};`);
};

describe('web and native design token parity', () => {
  it('keeps the light theme core colors aligned', () => {
    expectCssVariable('--background', LightColors.background.root);
    expectCssVariable('--foreground', LightColors.text.primary);
    expectCssVariable('--surface', LightColors.background.default);
    expectCssVariable('--overlay', LightColors.background.elevated);
    expectCssVariable('--muted', LightColors.text.muted);
    expectCssVariable('--accent', LightColors.accent);
    expectCssVariable('--success', LightColors.success);
    expectCssVariable('--warning', LightColors.warning);
    expectCssVariable('--danger', LightColors.error);
    expectCssVariable('--border', LightColors.border.default);
    expectCssVariable('--separator', LightColors.border.light);
  });

  it('keeps the dark theme core colors aligned', () => {
    expectCssVariable('--background', DarkColors.background.root);
    expectCssVariable('--foreground', DarkColors.text.primary);
    expectCssVariable('--surface', DarkColors.background.default);
    expectCssVariable('--overlay', DarkColors.background.elevated);
    expectCssVariable('--muted', DarkColors.text.muted);
    expectCssVariable('--accent', DarkColors.accent);
    expectCssVariable('--success', DarkColors.success);
    expectCssVariable('--warning', DarkColors.warning);
    expectCssVariable('--danger', DarkColors.error);
    expectCssVariable('--border', DarkColors.border.default);
    expectCssVariable('--separator', DarkColors.border.light);
  });

  it('derives module colors from the canonical color resource', () => {
    expect(ThemeModuleColors).toBe(ModuleColors);

    for (const key of ['inbound', 'outbound', 'orders', 'inventory', 'materials'] as const) {
      expect(ModuleColors.light[key]).toBe(LightColors.module[key]);
      expect(ModuleColors.dark[key]).toBe(DarkColors.module[key]);
    }

    expect(ModuleColors.light.settings).toBe(LightColors.module.settings.light);
    expect(ModuleColors.dark.settings).toBe(DarkColors.module.settings.dark);
  });

  it('exposes semantic tokens for shared form, dialog and feedback UI', () => {
    expect(Typography.formLabel).toMatchObject({ fontWeight: '600', letterSpacing: 0 });
    expect(Typography.formHint).toMatchObject({ fontWeight: '400', letterSpacing: 0 });
    expect(Typography.dialogTitle).toMatchObject({ fontWeight: '800', letterSpacing: 0 });
    expect(Typography.dialogBody).toMatchObject({ fontWeight: '400', letterSpacing: 0 });
    expect(Typography.dialogAction).toMatchObject({ fontWeight: '700', letterSpacing: 0 });
    expect(Typography.dialogNote).toMatchObject({ fontWeight: '400', letterSpacing: 0 });
    expect(Typography.feedback).toMatchObject({ fontWeight: '800', letterSpacing: 0 });
  });
});
