import { render, screen, waitFor } from '@testing-library/react';
import type { IThemeRGB, ThemeDefinition } from '@librechat/client';
import ConfiguredThemeProvider, { resolveConfiguredTheme } from './ConfiguredThemeProvider';

/**
 * The loader's external behaviour, and nothing else.
 *
 * Upstream owns `validateThemeDefinition` and has its own tests for it; asserting
 * here which colour tokens exist would spend fork budget re-stating somebody else's
 * contract, and would break every time the design system grows a token. What is
 * tested is what this module decides: a valid theme reaches the provider, an invalid
 * one is dropped **whole** with the default left rendering, and the page says which
 * of those happened.
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

function renderProvider() {
  return render(
    <ConfiguredThemeProvider>
      <span>{'child'}</span>
    </ConfiguredThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetThemeFromEnv.mockReturnValue(undefined);
  mockUseGetStartupConfig.mockReturnValue({ data: undefined });
  delete document.documentElement.dataset.themeSource;
});

describe('resolveConfiguredTheme', () => {
  it('passes a valid definition through untouched', () => {
    expect(resolveConfiguredTheme(validTheme)).toEqual({
      definition: validTheme,
      source: 'config',
    });
  });

  it('treats an absent theme as the default rather than as an error', () => {
    const onInvalid = jest.fn();

    expect(resolveConfiguredTheme(undefined, onInvalid)).toEqual({
      definition: undefined,
      source: 'default',
    });
    expect(onInvalid).not.toHaveBeenCalled();
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

    const { themeDefinition } = mockThemeProviderProps.mock.calls.at(-1)[0];
    expect(Object.keys(themeDefinition.modes)).toEqual(['light', 'dark']);
  });

  it('renders the default when the configured theme is invalid', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUseGetStartupConfig.mockReturnValue({
      data: { theme: { version: 1, name: 'cypher', modes: { ligth: {} } } },
    });

    renderProvider();

    const props = mockThemeProviderProps.mock.calls.at(-1)[0];
    expect(props.themeDefinition).toBeUndefined();
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

    const props = mockThemeProviderProps.mock.calls.at(-1)[0];
    expect(props.themeDefinition).toBeUndefined();
    expect(props.themeRGB).toBeUndefined();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('leaves the legacy environment path working when nothing is configured', () => {
    mockGetThemeFromEnv.mockReturnValue({ 'rgb-link': '1 2 3' });

    renderProvider();

    const props = mockThemeProviderProps.mock.calls.at(-1)[0];
    expect(props.themeRGB).toEqual({ 'rgb-link': '1 2 3' });
    expect(props.initialTheme).toBe('system');
  });

  it('prefers a configured theme over the environment one', () => {
    mockGetThemeFromEnv.mockReturnValue({ 'rgb-link': '1 2 3' });
    mockUseGetStartupConfig.mockReturnValue({ data: { theme: validTheme } });

    renderProvider();

    const props = mockThemeProviderProps.mock.calls.at(-1)[0];
    expect(props.themeDefinition).toEqual(validTheme);
    expect(props.themeRGB).toBeUndefined();
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
