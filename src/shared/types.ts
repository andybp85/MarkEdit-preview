export type ColorScheme = 'light' | 'dark' | 'auto';

/** A scheme the preview actually paints in, i.e. ColorScheme with auto resolved. */
export type ResolvedColorScheme = Exclude<ColorScheme, 'auto'>;
