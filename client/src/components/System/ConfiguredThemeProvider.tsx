import { useMemo } from 'react';
import { ThemeProvider, validateThemeDefinition } from '@librechat/client';
import type { ThemeDefinition, IThemeRGB } from '@librechat/client';
import type { ReactNode } from 'react';
import { getThemeFromEnv } from '~/utils/getThemeFromEnv';
import { useGetStartupConfig } from '~/data-provider';

/** Which theme the product is actually rendering, published for an administrator. */
export type ThemeSource = 'config' | 'invalid' | 'env' | 'default';

export interface ResolvedConfiguredTheme {
  definition?: ThemeDefinition;
  source: ThemeSource;
}

/**
 * Decides whether a configured theme may render, and says which theme won.
 *
 * `validateThemeDefinition` owns what a valid theme is; this neither repeats nor
 * repairs it. A definition that fails is dropped whole rather than partially applied,
 * because a half-applied theme is a product with one wrong colour and no way to tell
 * that from a design decision.
 */
export function resolveConfiguredTheme(
  theme?: unknown,
  onInvalid?: (errors: string[]) => void,
): ResolvedConfiguredTheme {
  if (theme == null) {
    return { source: 'default' };
  }

  const errors = validateThemeDefinition(theme as ThemeDefinition);
  if (errors.length > 0) {
    onInvalid?.(errors);
    return { source: 'invalid' };
  }

  return { definition: theme as ThemeDefinition, source: 'config' };
}

/**
 * Reads the deployment's theme out of the startup config and hands it to the provider
 * — the whole of the theme loader, and deliberately nothing more.
 *
 * The theme itself lives in `librechat.yaml`, outside this repository, which is the
 * point: a theme carried as a fork edit spends diff budget every week in
 * `packages/client/src/theme`, a permanent conflict site. Loaded from configuration it
 * costs nothing after this lands. `getThemeFromEnv` is the same move for the legacy
 * RGB-only path and keeps working unchanged when nothing is configured.
 *
 * An invalid theme leaves the bundled default rendering: a branding mistake must never
 * take the interface down. It must not be silent either, so the validator's own
 * wording is logged rather than a summary, and the winning source is published on the
 * document element as `data-theme-source`. "It did not load" and "it loaded and looks
 * wrong" have the same symptom and different fixes, and this is what tells them apart
 * without a rebuild.
 */
export default function ConfiguredThemeProvider({ children }: { children: ReactNode }) {
  const { data: startupConfig } = useGetStartupConfig();
  const envTheme: IThemeRGB | undefined = getThemeFromEnv();

  const { definition, source } = useMemo<ResolvedConfiguredTheme>(() => {
    const resolved = resolveConfiguredTheme(startupConfig?.theme, (errors) => {
      console.error(
        `[theme] the configured theme was rejected and the default is rendering instead:\n  ${errors.join(
          '\n  ',
        )}`,
      );
    });

    if (resolved.source === 'default' && envTheme) {
      return { source: 'env' };
    }
    return resolved;
  }, [startupConfig?.theme, envTheme]);

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.themeSource = source;
  }

  return (
    <ThemeProvider
      {...(definition && { themeDefinition: definition })}
      {...(!definition && envTheme && { initialTheme: 'system', themeRGB: envTheme })}
    >
      {children}
    </ThemeProvider>
  );
}
