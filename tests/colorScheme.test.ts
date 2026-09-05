// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('markedit-api', () => ({ MarkEdit: {} }));

// The module tracks the scheme in module state, so every test gets its own copy.
async function importColorScheme() {
  vi.resetModules();
  return await import('../src/support/colorScheme');
}

function setSystemDarkMode(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => { /* the tests drive changes through the editor */ },
    removeEventListener: () => { /* nothing to release */ },
  }));
}

// happy-dom reports '' for a background nothing sets, so a test that wants an
// answer has to paint the element itself.
function appendEditor(background: string) {
  const editor = document.createElement('div');
  editor.className = 'cm-editor';
  editor.style.backgroundColor = background;

  const content = document.createElement('div');
  content.className = 'cm-content';
  editor.appendChild(content);

  document.body.appendChild(editor);
  return editor;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.style.backgroundColor = '';
  setSystemDarkMode(false);
});

describe('currentColorScheme', () => {
  test('reads the scheme from the editor background', async () => {
    const { currentColorScheme } = await importColorScheme();

    appendEditor('rgb(13, 17, 23)');
    expect(currentColorScheme()).toBe('dark');

    document.body.innerHTML = '';
    appendEditor('rgb(255, 255, 255)');
    expect(currentColorScheme()).toBe('light');
  });

  test('walks past a transparent surface to the ancestor that paints', async () => {
    const { currentColorScheme } = await importColorScheme();

    appendEditor('rgba(0, 0, 0, 0)');
    document.body.style.backgroundColor = 'rgb(13, 17, 23)';
    expect(currentColorScheme()).toBe('dark');
  });

  test('follows the editor rather than the window appearance', async () => {
    const { currentColorScheme } = await importColorScheme();

    setSystemDarkMode(true);
    appendEditor('rgb(255, 255, 255)');
    expect(currentColorScheme()).toBe('light');
  });

  test('falls back to the window appearance with no editor present', async () => {
    const { currentColorScheme } = await importColorScheme();

    setSystemDarkMode(true);
    expect(currentColorScheme()).toBe('dark');

    setSystemDarkMode(false);
    expect(currentColorScheme()).toBe('light');
  });
});

describe('onColorSchemeChange', () => {
  test('reports a theme swap and stops on unsubscribe', async () => {
    const { onColorSchemeChange } = await importColorScheme();
    const editor = appendEditor('rgb(255, 255, 255)');

    const listener = vi.fn();
    const unsubscribe = onColorSchemeChange(listener);

    editor.style.backgroundColor = 'rgb(13, 17, 23)';
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('dark'));

    unsubscribe();
    listener.mockClear();

    editor.style.backgroundColor = 'rgb(255, 255, 255)';
    await nextFrame();
    await nextFrame();
    expect(listener).not.toHaveBeenCalled();
  });

  test('stays quiet when a mutation leaves the scheme alone', async () => {
    const { onColorSchemeChange } = await importColorScheme();
    const editor = appendEditor('rgb(255, 255, 255)');

    const listener = vi.fn();
    onColorSchemeChange(listener);

    editor.style.backgroundColor = 'rgb(250, 250, 250)';
    await nextFrame();
    await nextFrame();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('appendSchemeStyle', () => {
  test('enables the sheet of the resolved scheme and swaps on a change', async () => {
    const { appendSchemeStyle } = await importColorScheme();
    const editor = appendEditor('rgb(255, 255, 255)');

    appendSchemeStyle('.light { color: red }', '.dark { color: blue }');
    const [light, dark] = Array.from(document.head.querySelectorAll('style'));
    expect([light.disabled, dark.disabled]).toEqual([false, true]);

    editor.style.backgroundColor = 'rgb(13, 17, 23)';
    await vi.waitFor(() => expect([light.disabled, dark.disabled]).toEqual([true, false]));
  });
});
