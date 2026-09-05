import { MarkEdit } from 'markedit-api';
import { appendStyle } from '../shared/utils';
import type { ResolvedColorScheme } from '../shared/types';

/**
 * The color scheme the preview paints in, resolved from what the editor
 * actually looks like rather than from `prefers-color-scheme`.
 *
 * MarkEdit's editor theme and the native window appearance move independently:
 * `Settings > Appearance` drives both, but a user script that swaps the editor
 * theme moves only the editor, and the media query never sees it. Reading the
 * luminance of the editor background follows every mechanism without coupling
 * to any of them.
 *
 * With no editor in the document (the Quick Look host renders a preview with no
 * editing surface) there is nothing to read, and the media query is the answer.
 */

/** Channels in 0..255, alpha in 0..1. */
interface Rgba {
  a: number;
  b: number;
  g: number;
  r: number;
}

// getComputedStyle reports a background color as an rgb() or rgba() function,
// in either the comma or the space syntax. Anything else — the keyword
// `transparent`, a form a future engine reports — is unknown, and the walk
// continues to the ancestor rather than guessing.
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

/**
 * The contrast ratio against white is 1.05 / (L + 0.05) and against black is
 * (L + 0.05) / 0.05. They are equal at L = 0.17912878, which makes it the point
 * where a surface stops reading as light and starts reading as dark.
 */
const LUMINANCE_THRESHOLD = 0.179;

const ATTRIBUTES = { attributeFilter: ['class', 'style'], attributes: true };

const listeners = new Set<(scheme: ResolvedColorScheme) => void>();

const states: {
  observer: MutationObserver | undefined;
  observedEditor: Element | undefined;
  pendingFrame: number | undefined;
  // The scheme listeners were last told about, so a mutation burst that changes
  // nothing wakes nobody. Never a cache — the answer is always recomputed.
  reportedScheme: ResolvedColorScheme | undefined;
} = {
  observer: undefined,
  observedEditor: undefined,
  pendingFrame: undefined,
  reportedScheme: undefined,
};

/**
 * Resolved fresh on every call. Style recalculation is what answers it and the
 * callers are all cold paths (a render, a repaint, a search); a cached answer
 * would only be a second thing to keep in sync with the editor.
 */
export function currentColorScheme(): ResolvedColorScheme {
  const background = surfaceBackground(editorSurface());
  if (background !== undefined) {
    return isDarkBackground(background) ? 'dark' : 'light';
  }

  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Subscribe to scheme changes. Returns its own unsubscribe.
 */
export function onColorSchemeChange(listener: (scheme: ResolvedColorScheme) => void) {
  listeners.add(listener);
  startTracking();
  return () => listeners.delete(listener);
}

/**
 * Two stylesheets, one for each scheme, with the one that does not apply
 * disabled. Toggling `disabled` is what lets the theme CSS keep the selectors
 * it already has: rewriting every rule to sit under an attribute selector would
 * mean rewriting the theme files, and a media query cannot see the editor.
 */
export function appendSchemeStyle(lightCss: string, darkCss: string) {
  const light = appendStyle(lightCss, false);
  const dark = appendStyle(darkCss, false);

  const apply = (scheme: ResolvedColorScheme) => {
    light.disabled = scheme !== 'light';
    dark.disabled = scheme !== 'dark';
  };

  apply(currentColorScheme());
  return onColorSchemeChange(apply);
}

/**
 * The first background an element or one of its ancestors actually paints.
 *
 * `.cm-content` is usually transparent and the color lives on an ancestor, so
 * the walk continues past an answer `parseRgba` does not recognize (the keyword
 * `transparent`) and past one that parses but is fully see-through.
 */
function surfaceBackground(element: Element | null): Rgba | undefined {
  for (let node = element; node !== null; node = node.parentElement) {
    const color = parseRgba(getComputedStyle(node).backgroundColor);
    if (color !== undefined && color.a > 0) {
      return color;
    }
  }

  return undefined;
}

function parseRgba(color: string): Rgba | undefined {
  const args = RGB_FUNCTION.exec(color.trim())?.[1];
  if (args === undefined) {
    return undefined;
  }

  const channels = args.split(/[\s,/]+/).filter(part => part.length > 0).map(Number);
  if (channels.length < 3 || channels.length > 4 || channels.some(isNaN)) {
    return undefined;
  }

  const [r, g, b, a = 1] = channels;
  return { a, b, g, r };
}

function isDarkBackground({ b, g, r }: Rgba) {
  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  return luminance <= LUMINANCE_THRESHOLD;
}

function linearize(channel: number) {
  const ratio = channel / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
}

function editorSurface() {
  return MarkEdit.editorView?.contentDOM
    ?? document.querySelector('.cm-content')
    ?? document.querySelector('.cm-editor');
}

function systemPrefersDark() {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function startTracking() {
  if (states.observer !== undefined) {
    return;
  }

  const observer = new MutationObserver(scheduleUpdate);
  states.observer = observer;
  states.reportedScheme = currentColorScheme();

  // A theme swap reconfigures CodeMirror's theme compartment, which appends the
  // new rules to `<head>` and puts a freshly generated class on `.cm-editor`.
  // The app appearance instead restyles the document root and body. Watching
  // all four, plus the media query for hosts with no editor at all, covers
  // every route a scheme can change by.
  observer.observe(document.head, { childList: true });
  observer.observe(document.documentElement, ATTRIBUTES);
  observer.observe(document.body, { ...ATTRIBUTES, childList: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleUpdate);

  observeEditor(observer);
}

// `.cm-editor` is absent until MarkEdit builds the editor, and the body
// childList observer above is what brings the walk back here once it appears.
function observeEditor(observer: MutationObserver) {
  const editor = document.querySelector('.cm-editor');
  if (editor === null || editor === states.observedEditor) {
    return;
  }

  states.observedEditor = editor;
  observer.observe(editor, ATTRIBUTES);
}

// Style recalculation is what answers currentColorScheme, and a theme swap
// lands as a burst of mutations. Coalescing to one frame asks the question one
// time for the whole burst.
function scheduleUpdate() {
  if (states.pendingFrame !== undefined) {
    return;
  }

  states.pendingFrame = requestAnimationFrame(() => {
    states.pendingFrame = undefined;
    applyResolvedScheme();
  });
}

function applyResolvedScheme() {
  if (states.observer !== undefined) {
    observeEditor(states.observer);
  }

  const scheme = currentColorScheme();
  if (scheme === states.reportedScheme) {
    return;
  }

  states.reportedScheme = scheme;
  listeners.forEach(listener => listener(scheme));
}
