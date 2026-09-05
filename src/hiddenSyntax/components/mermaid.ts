import { WidgetType, type EditorView } from '@codemirror/view';
import { renderMermaidSVG } from '../../render';
import { onColorSchemeChange } from '../../support/colorScheme';

export class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-md-syntaxHiddenMermaid';

    let renderVersion = 0;

    const render = () => {
      const version = ++renderVersion;
      void renderMermaidSVG(this.source).then(svg => {
        if (!container.isConnected || version !== renderVersion) {
          return;
        }

        container.classList.remove('cm-md-syntaxHiddenMermaidError');
        container.innerHTML = svg;
        view.requestMeasure();
      }, () => {
        if (!container.isConnected || version !== renderVersion) {
          return;
        }

        container.classList.add('cm-md-syntaxHiddenMermaidError');
        container.textContent = this.source;
        view.requestMeasure();
      });
    };

    // Mixed mode draws into the editor, so a diagram follows the editor theme
    // rather than the window appearance.
    const unsubscribe = onColorSchemeChange(render);
    disposables.set(container, () => {
      renderVersion += 1;
      unsubscribe();
    });

    render();
    return container;
  }

  destroy(dom: HTMLElement) {
    disposables.get(dom)?.();
    disposables.delete(dom);
  }

  eq(other: MermaidWidget) {
    return other.source === this.source;
  }

  ignoreEvent() {
    return false;
  }
}

const disposables = new WeakMap<HTMLElement, () => void>();
