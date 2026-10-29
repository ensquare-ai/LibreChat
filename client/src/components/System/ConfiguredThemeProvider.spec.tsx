import { ThemeContext } from '@librechat/client';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { IThemeRGB, ThemeDefinition } from '@librechat/client';
import type { ContextType } from 'react';
import type { LocationSource } from './ConfiguredThemeProvider';
import ConfiguredThemeProvider, {
  isLoginPath,
  resolveConfiguredTheme,
  StoredThemeReconciler,
} from './ConfiguredThemeProvider';

/**
 * The loader's external behaviour, and nothing else.
 *
 * Upstream owns `validateThemeDefinition` and has its own tests for it; asserting
 * here which colour tokens exist would spend fork budget re-stating somebody else's
 * contract, and would break every time the design system grows a token. What is
 * tested is what this module decides: a valid theme reaches the provider, an invalid
 * one is dropped **whole** with the default left rendering, a `login`-scoped theme
 * reaches the provider on the sign-in screens and nowhere else, and the page says
 * which of those happened.
 */

const mockUseGetStartupConfig = jest.fn();
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

const mockGetThemeFromEnv = jest.fn<IThemeRGB | undefined, []>(() => undefined);
jest.mock('~/utils/getThemeFromEnv', () => ({
  getThemeFromEnv: () => mockGetThemeFromEnv(),
}));

const mockThemeProviderProps = jest.fn();
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return {
    ...actual,
    /** A spy, not a stub: the real validator still decides what is valid. */
    ThemeProvider: (props) => {
      mockThemeProviderProps(props);
      return <div data-testid="theme-provider">{props.children}</div>;
    },
  };
});

const validTheme: ThemeDefinition = {
  version: 1,
  name: 'cypher',
  modes: {
    light: { colors: { 'rgb-accent-primary': '13 110 253' } },
    dark: { colors: { 'rgb-accent-primary': '110 168 254' } },
  },
};

const loginTheme = { ...validTheme, scope: 'login' };

/** The two things the loader reads from the real router: where it is, and when that moves. */
function fakeRouter(pathname: string) {
  const listeners = new Set<() => void>();
  const router: LocationSource & { navigate: (next: string) => void } = {
    state: { location: { pathname } },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: (next) => {
      router.state = { location: { pathname: next } };
      listeners.forEach((listener) => listener());
    },
  };
  return router;
}

function renderProvider(router?: LocationSource) {
  return render(
    <ConfiguredThemeProvider router={router}>
      <span>{'child'}</span>
    </ConfiguredThemeProvider>,
  );
}

const lastProviderProps = () => mockThemeProviderProps.mock.calls.at(-1)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetThemeFromEnv.mockReturnValue(undefined);
  mockUseGetStartupConfig.mockReturnValue({ data: undefined });
  delete document.documentElement.dataset.themeSource;
  delete document.documentElement.dataset.themeScope;
});

describe('resolveConfiguredTheme', () => {
  it('passes a valid definition through untouched', () => {
    expect(resolveConfiguredTheme(validTheme)).toEqual({
      definition: validTheme,
      source: 'config',
      scope: 'everywhere',
    });
  });

  it('treats an absent theme as the default rather than as an error', () => {
    const onInvalid = jest.fn();

    expect(resolveConfiguredTheme(undefined, onInvalid)).toEqual({
      definition: undefined,
      source: 'default',
      scope: 'everywhere',
    });
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('reads the scope off before the validator sees the definition', () => {
    /** The validator rejects any field it does not know, and `scope` is this
     *  loader's word rather than the design system's. */
    expect(resolveConfiguredTheme(loginTheme)).toEqual({
      definition: validTheme,
      source: 'config',
      scope: 'login',
    });
  });

  it('drops a definition with an unknown token rather than applying it in part', () => {
    /** A half-applied theme is a product with one wrong colour and no way to tell
     *  that from a design decision. */
    const unknownToken = {
      ...validTheme,
      modes: { light: { colors: { 'rgb-not-a-token': '0 0 0' } } },
    };

    const { definition, source } = resolveConfiguredTheme(unknownToken, () => {});

    expect(definition).toBeUndefined();
    expect(source).toBe('invalid');
  });

  it("surfaces the validator's own errors rather than a summary", () => {
    const onInvalid = jest.fn();

    resolveConfiguredTheme({ version: 2, name: 'x', modes: {} }, onInvalid);

    expect(onInvalid).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('version')]),
    );
  });

  it('rejects a definition that is not an object at all', () => {
    expect(resolveConfiguredTheme('cypher', () => {}).source).toBe('invalid');
  });
});

describe('isLoginPath', () => {
  it.each(['/login', '/login/2fa', '/register', '/forgot-password', '/reset-password', '/verify'])(
    'knows %s as a sign-in screen',
    (pathname) => {
      expect(isLoginPath(pathname)).toBe(true);
    },
  );

  it.each(['/', '/c/new', '/c/abc', '/loginx', '/share/abc'])(
    'knows %s as the product',
    (pathname) => {
      expect(isLoginPath(pathname)).toBe(false);
    },
  );
});

describe('ConfiguredThemeProvider', () => {
  it('hands a valid configured theme to the provider', async () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { theme: validTheme } });

    renderProvider();

    await waitFor(() =>
      expect(mockThemeProviderProps).toHaveBeenCalledWith(
        expect.objectContaining({ themeDefinition: validTheme }),
      ),
    );
  });

  it('carries both modes through, so either preference sees the brand', async () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { theme: validTheme } });

    renderProvider();

    const { themeDefinition } = lastProviderProps();
    expect(Object.keys(themeDefinition.modes)).toEqual(['light', 'dark']);
  });

  it('renders the default when the configured theme is invalid', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUseGetStartupConfig.mockReturnValue({
      data: { theme: { version: 1, name: 'cypher', modes: { ligth: {} } } },
    });

    renderProvider();

    expect(lastProviderProps().themeDefinition).toBeUndefined();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('says out loud that it rejected a theme', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUseGetStartupConfig.mockReturnValue({
      data: { theme: { version: 9, name: 'cypher', modes: {} } },
    });

    renderProvider();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('the default is rendering'));
  });

  it('renders the default without error when nothing is configured', () => {
    renderProvider();

    const props = lastProviderProps();
    expect(props.themeDefinition).toBeUndefined();
    expect(props.themeRGB).toBeUndefined();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('leaves the legacy environment path working when nothing is configured', () => {
    mockGetThemeFromEnv.mockReturnValue({ 'rgb-link': '1 2 3' });

    renderProvider();

    const props = lastProviderProps();
    expect(props.themeRGB).toEqual({ 'rgb-link': '1 2 3' });
    expect(props.initialTheme).toBe('system');
  });

  it('prefers a configured theme over the environment one', () => {
    mockGetThemeFromEnv.mockReturnValue({ 'rgb-link': '1 2 3' });
    mockUseGetStartupConfig.mockReturnValue({ data: { theme: validTheme } });

    renderProvider();

    const props = lastProviderProps();
    expect(props.themeDefinition).toEqual(validTheme);
    expect(props.themeRGB).toBeUndefined();
  });

  describe('a theme confined to the sign-in screens', () => {
    beforeEach(() => {
      mockUseGetStartupConfig.mockReturnValue({ data: { theme: loginTheme } });
    });

    it('reaches the provider on the sign-in screen', () => {
      renderProvider(fakeRouter('/login'));

      expect(lastProviderProps().themeDefinition).toEqual(validTheme);
      expect(document.documentElement.dataset.themeSource).toBe('config');
      expect(document.documentElement.dataset.themeScope).toBe('login');
    });

    it('is withheld inside the product, where the default renders', () => {
      renderProvider(fakeRouter('/c/new'));

      expect(lastProviderProps().themeDefinition).toBeUndefined();
      expect(document.documentElement.dataset.themeSource).toBe('default');
      expect(document.documentElement.dataset.themeScope).toBe('login');
    });

    it('follows the router from the sign-in screen into the product and back', () => {
      const router = fakeRouter('/login');
      renderProvider(router);
      expect(lastProviderProps().themeDefinition).toEqual(validTheme);

      act(() => router.navigate('/c/new'));
      expect(lastProviderProps().themeDefinition).toBeUndefined();

      act(() => router.navigate('/login/2fa'));
      expect(lastProviderProps().themeDefinition).toEqual(validTheme);
    });

    it('does not let the environment theme in where it is withheld', () => {
      /** A configured theme wins over the environment one everywhere, including on
       *  the screens it declines to colour; otherwise two palettes would alternate. */
      mockGetThemeFromEnv.mockReturnValue({ 'rgb-link': '1 2 3' });

      renderProvider(fakeRouter('/c/new'));

      const props = lastProviderProps();
      expect(props.themeDefinition).toBeUndefined();
      expect(props.themeRGB).toBeUndefined();
    });
  });

  it('renders an unscoped theme everywhere, whatever the route', () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { theme: validTheme } });

    renderProvider(fakeRouter('/c/new'));

    expect(lastProviderProps().themeDefinition).toEqual(validTheme);
    expect(document.documentElement.dataset.themeScope).toBeUndefined();
  });

  describe('which theme is in force', () => {
    /** "It did not load" and "it loaded and looks wrong" have the same symptom and
     *  different fixes, so the page has to say which. */
    const cases: Array<[string, Record<string, unknown>, IThemeRGB | undefined]> = [
      ['config', { theme: validTheme }, undefined],
      ['invalid', { theme: { version: 1, name: 'x', modes: { ligth: {} } } }, undefined],
      ['default', {}, undefined],
      ['env', {}, { 'rgb-link': '1 2 3' }],
    ];

    it.each(cases)('publishes %s on the document element', (expected, config, envTheme) => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockGetThemeFromEnv.mockReturnValue(envTheme);
      mockUseGetStartupConfig.mockReturnValue({ data: config });

      renderProvider();

      expect(document.documentElement.dataset.themeSource).toBe(expected);
    });
  });
});

describe('StoredThemeReconciler', () => {
  /** The provider restores the last theme it persisted before any configuration has
   *  arrived. The reconciler is what stops that theme outliving its configuration. */
  const stored: ThemeDefinition = { ...validTheme, name: 'stale' };

  function renderWith(
    context: Partial<ContextType<typeof ThemeContext>>,
    props: { active: boolean; definition?: ThemeDefinition },
  ) {
    const setThemeDefinition = jest.fn();
    render(
      <ThemeContext.Provider
        value={{
          theme: 'system',
          setTheme: jest.fn(),
          resolvedMode: 'light',
          highContrast: false,
          setThemeRGB: jest.fn(),
          setThemeDefinition,
          setThemeName: jest.fn(),
          resetTheme: jest.fn(),
          ...context,
        }}
      >
        <StoredThemeReconciler {...props} />
      </ThemeContext.Provider>,
    );
    return setThemeDefinition;
  }

  it('clears a stored theme on a page the configuration leaves unthemed', () => {
    const setThemeDefinition = renderWith({ themeDefinition: stored }, { active: true });

    expect(setThemeDefinition).toHaveBeenCalledWith(undefined);
  });

  it('leaves the provider alone while the configuration is still loading', () => {
    /** Clearing before the configuration is here would flash the default on a page
     *  that is about to be themed again. */
    const setThemeDefinition = renderWith({ themeDefinition: stored }, { active: false });

    expect(setThemeDefinition).not.toHaveBeenCalled();
  });

  it('leaves a theme the loader is handing over alone', () => {
    const setThemeDefinition = renderWith(
      { themeDefinition: stored },
      { active: true, definition: validTheme },
    );

    expect(setThemeDefinition).not.toHaveBeenCalled();
  });

  it('has nothing to do when nothing was stored', () => {
    const setThemeDefinition = renderWith({}, { active: true });

    expect(setThemeDefinition).not.toHaveBeenCalled();
  });
});
