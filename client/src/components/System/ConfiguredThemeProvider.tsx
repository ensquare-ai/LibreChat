import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ThemeProvider, useTheme, validateThemeDefinition } from '@librechat/client';
import type { ThemeDefinition, IThemeRGB } from '@librechat/client';
import type { ThemeScope } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { getThemeFromEnv } from '~/utils/getThemeFromEnv';
import { useGetStartupConfig } from '~/data-provider';

/** Which theme the product is actually rendering, published for an administrator. */
export type ThemeSource = 'config' | 'invalid' | 'env' | 'default';

export interface ResolvedConfiguredTheme {
  definition?: ThemeDefinition;
  source: ThemeSource;
  /** Where the configured theme is meant to render: everywhere unless the file says `login`. */
  scope: ThemeScope;
}

/** What the loader needs from the router: where the visitor is, and a way to hear that change. */
export interface LocationSource {
  state: { location: { pathname: string } };
  subscribe: (listener: () => void) => () => void;
}

/**
 * The screens a visitor meets before signing in, as `~/routes` spells them. A
 * `login`-scoped theme renders on these and nowhere else.
 */
export const LOGIN_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify',
] as const;

export function isLoginPath(pathname: string): boolean {
  return LOGIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `scope` is this loader's word, not the design system's. `validateThemeDefinition`
 * rejects any field it does not know, so the scope is read and taken off before the
 * rest of the definition is judged. A theme without one renders everywhere, which is
 * what a theme meant before the field existed.
 */
function splitScope(theme: unknown): { scope: ThemeScope; candidate: unknown } {
  if (!isRecord(theme)) {
    return { scope: 'everywhere', candidate: theme };
  }
  const { scope, ...candidate } = theme;
  return { scope: scope === 'login' ? 'login' : 'everywhere', candidate };
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
    return { source: 'default', scope: 'everywhere' };
  }

  const { scope, candidate } = splitScope(theme);
  const errors = validateThemeDefinition(candidate as ThemeDefinition);
  if (errors.length > 0) {
    onInvalid?.(errors);
    return { source: 'invalid', scope };
  }

  return { definition: candidate as ThemeDefinition, source: 'config', scope };
}

/** The source the page reports: the environment theme only ever fills an empty slot. */
function sourceInForce(
  resolved: ResolvedConfiguredTheme,
  withheld: boolean,
  envTheme?: IThemeRGB,
): ThemeSource {
  if (withheld) {
    return 'default';
  }
  if (resolved.source === 'default' && envTheme) {
    return 'env';
  }
  return resolved.source;
}

const noRouter: LocationSource = {
  state: { location: { pathname: '/' } },
  subscribe: () => () => undefined,
};

/** The current pathname, re-read whenever the router says the location changed. */
function useRouterPathname(router: LocationSource): string {
  const subscribe = useCallback((listener: () => void) => router.subscribe(listener), [router]);
  const read = useCallback(() => router.state.location.pathname, [router]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Clears a theme the provider restored from the browser's storage when this page is
 * not meant to carry one.
 *
 * The provider persists the last theme it was handed and restores it on the next visit
 * before any configuration has arrived. That is right for a theme that renders
 * everywhere and wrong for every other case: a theme removed from the deployment would
 * keep rendering for everyone who had once seen it, and a `login`-scoped theme would
 * follow a returning user from the sign-in screen into the product. Nothing is cleared
 * until the configuration is actually here, so a reload never flashes the default on a
 * page that is about to be themed.
 */
export function StoredThemeReconciler({
  active,
  definition,
}: {
  active: boolean;
  definition?: ThemeDefinition;
}) {
  const { themeDefinition, setThemeDefinition } = useTheme();

  useEffect(() => {
    if (!active || definition !== undefined || themeDefinition === undefined) {
      return;
    }
    setThemeDefinition(undefined);
  }, [active, definition, themeDefinition, setThemeDefinition]);

  return null;
}

/**
 * Reads the deployment's theme out of the startup config and hands it to the provider
 * — the whole of the theme loader, and deliberately little more.
 *
 * The theme itself lives in `librechat.yaml`, outside this repository, which is the
 * point: a theme carried as a fork edit spends diff budget every week in
 * `packages/client/src/theme`, a permanent conflict site. Loaded from configuration it
 * costs nothing after this lands. `getThemeFromEnv` is the same move for the legacy
 * RGB-only path and keeps working unchanged when nothing is configured.
 *
 * A theme may be confined to the sign-in screens with `scope: login`. The loader then
 * hands the definition over only while the router is on one of `LOGIN_PATHS`, and
 * withholds it everywhere else so the bundled default renders once a user is in. The
 * provider already follows its props when they change, so a navigation is enough.
 *
 * An invalid theme leaves the bundled default rendering: a branding mistake must never
 * take the interface down. It must not be silent either, so the validator's own
 * wording is logged rather than a summary, and the winning source is published on the
 * document element as `data-theme-source`, with `data-theme-scope` beside it when the
 * theme is confined. "It did not load" and "it loaded and looks wrong" have the same
 * symptom and different fixes, and this is what tells them apart without a rebuild.
 */
export default function ConfiguredThemeProvider({
  children,
  router = noRouter,
}: {
  children: ReactNode;
  router?: LocationSource;
}) {
  const { data: startupConfig } = useGetStartupConfig();
  const envTheme: IThemeRGB | undefined = getThemeFromEnv();
  const pathname = useRouterPathname(router);

  const resolved = useMemo<ResolvedConfiguredTheme>(
    () =>
      resolveConfiguredTheme(startupConfig?.theme, (errors) => {
        console.error(
          `[theme] the configured theme was rejected and the default is rendering instead:\n  ${errors.join(
            '\n  ',
          )}`,
        );
      }),
    [startupConfig?.theme],
  );

  const confined = resolved.source === 'config' && resolved.scope === 'login';
  const withheld = confined && !isLoginPath(pathname);
  const definition = withheld ? undefined : resolved.definition;
  const source = sourceInForce(resolved, withheld, envTheme);

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.themeSource = source;
    if (confined) {
      document.documentElement.dataset.themeScope = 'login';
    } else {
      delete document.documentElement.dataset.themeScope;
    }
  }

  return (
    <ThemeProvider
      {...(definition && { themeDefinition: definition })}
      {...(source === 'env' && envTheme && { initialTheme: 'system', themeRGB: envTheme })}
    >
      <StoredThemeReconciler
        active={startupConfig !== undefined && source !== 'env'}
        definition={definition}
      />
      {children}
    </ThemeProvider>
  );
}
