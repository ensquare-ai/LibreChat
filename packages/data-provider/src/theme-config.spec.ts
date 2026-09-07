import { configSchema, themeSchema } from './config';

/**
 * The `theme` key exists for one reason: `librechat.yaml` is parsed strictly and an
 * unknown key calls `process.exit(1)`, so without it a themed configuration does not
 * boot at all. These tests hold the boundary the schema is responsible for — the
 * *shape* of a theme — and deliberately assert nothing about which colour or
 * appearance tokens are valid. That is `validateThemeDefinition`'s job in
 * `@librechat/client`, and a second copy of it here would be a second thing to drift.
 */

const validTheme = {
  version: 1 as const,
  name: 'cypher',
  modes: {
    light: { colors: { 'rgb-accent-primary': '13 110 253' } },
    dark: { colors: { 'rgb-accent-primary': '110 168 254' } },
  },
};

const minimalConfig = { version: '1.3.0' };

describe('themeSchema', () => {
  it('accepts a definition with both modes', () => {
    expect(themeSchema.safeParse(validTheme).success).toBe(true);
  });

  it('accepts a definition with only one mode', () => {
    const oneMode = { ...validTheme, modes: { dark: validTheme.modes.dark } };

    expect(themeSchema.safeParse(oneMode).success).toBe(true);
  });

  it('rejects a version it cannot render', () => {
    expect(themeSchema.safeParse({ ...validTheme, version: 2 }).success).toBe(false);
  });

  it('rejects an unnamed theme', () => {
    expect(themeSchema.safeParse({ ...validTheme, name: '' }).success).toBe(false);
  });

  it('rejects an unknown mode, because a typo would silently render nothing', () => {
    const typo = { ...validTheme, modes: { ...validTheme.modes, ligth: {} } };

    expect(themeSchema.safeParse(typo).success).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    expect(themeSchema.safeParse({ ...validTheme, colours: {} }).success).toBe(false);
  });

  it('does not judge the tokens inside a mode', () => {
    /** A token the design system does not know is a *client* error, surfaced by the
     *  validator with the default left standing. Rejecting it here would stop a
     *  deployment over a colour name, and would put the token list in two packages. */
    const unknownToken = {
      ...validTheme,
      modes: { light: { colors: { 'rgb-not-a-token': '0 0 0' } } },
    };

    expect(themeSchema.safeParse(unknownToken).success).toBe(true);
  });
});

describe('configSchema', () => {
  it('boots a configuration carrying a theme', () => {
    const result = configSchema.safeParse({ ...minimalConfig, theme: validTheme });

    expect(result.success).toBe(true);
  });

  it('boots a configuration carrying no theme', () => {
    expect(configSchema.safeParse(minimalConfig).success).toBe(true);
  });

  it('refuses a malformed theme rather than dropping it silently', () => {
    const result = configSchema.safeParse({
      ...minimalConfig,
      theme: { version: 1, modes: {} },
    });

    expect(result.success).toBe(false);
  });
});
