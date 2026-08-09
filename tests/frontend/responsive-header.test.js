import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

describe('cabeçalho responsivo', () => {
  it('mantém nomes acessíveis nos controles do cabeçalho e concentra idioma nas preferências', async () => {
    const html = await readFile(new URL('index.html', root), 'utf8');
    const app = await readFile(new URL('scripts/app.js', root), 'utf8');
    expect(html).toMatch(/id="queue-toggle-btn"[^>]+data-i18n-aria-label="nav\.queue"/);
    expect(html).not.toContain('id="lang-select"');
    expect(app).not.toContain('langSelect');
    expect(html).toMatch(/class="toggle-switch toggle-switch--theme"[^>]+data-i18n-aria-label="nav\.theme_label"/);
    expect(html).toMatch(/class="toggle-switch-input"[^>]+id="theme-toggle-input"/);
  });

  it('reutiliza um único componente visual para todos os toggles', async () => {
    const css = await readFile(new URL('styles/main.css', root), 'utf8');
    expect(css).toContain('.toggle-switch {');
    expect(css).toContain('.toggle-switch-input:checked + .toggle-switch-slider');
    expect(css).toContain('.toggle-switch--theme .toggle-switch-slider::after');
    expect(css).toContain('background: var(--ds-text-muted)');
    expect(css).not.toContain('.theme-toggle-slider');
    expect(css).not.toContain('.preferences-switch');
  });

  it('desativa o autocomplete nativo no campo gerenciado pelo histórico da aplicação', async () => {
    const html = await readFile(new URL('index.html', root), 'utf8');
    expect(html).toMatch(/id="analyze-form"[^>]+autocomplete="off"/);
    const input = html.match(/<input[\s\S]*?id="url-input"[\s\S]*?>/)?.[0] || '';
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('aria-controls="url-history-dropdown"');
    expect(input).toContain('data-1p-ignore="true"');
  });

  it('separa as ações da superfície do campo e usa toda a largura disponível', async () => {
    const html = await readFile(new URL('index.html', root), 'utf8');
    const css = await readFile(new URL('styles/main.css', root), 'utf8');
    const form = html.match(/<form id="analyze-form"[\s\S]*?<\/form>/)?.[0] || '';
    expect(form).toContain('class="search-box"');
    expect(form).toContain('class="search-actions"');
    expect(form.indexOf('</div>')).toBeLessThan(form.indexOf('id="analyze-btn"'));
    expect(css).toMatch(/\.search-box-wrapper \{[\s\S]*?width: 100%/);
    expect(css).toContain('.analysis-command {');
  });

  it('contém a profundidade do botão principal dentro da altura da seção', async () => {
    const css = await readFile(new URL('styles/main.css', root), 'utf8');
    const analyze = css.match(/#analyze-btn \{[\s\S]*?\}/)?.[0] || '';
    expect(analyze).toContain('height: 53px');
    expect(analyze).toContain('box-shadow: 0 3px');
    expect(css).toMatch(/\.search-actions \.btn \{[\s\S]*?height: 56px/);
  });

  it('compacta ações até 560 px, oculta o nome até 430 px e refina 320 px', async () => {
    const css = await readFile(new URL('styles/main.css', root), 'utf8');
    const compact = css.match(/@media \(max-width: 560px\) \{[\s\S]*?(?=\n@media \(max-width: 430px\))/)?.[0] || '';
    const phone = css.match(/@media \(max-width: 430px\) \{[\s\S]*?(?=\n@media \(max-width: 340px\))/)?.[0] || '';
    const narrow = css.match(/@media \(max-width: 340px\) \{[\s\S]*?\n\}/)?.[0] || '';

    expect(compact).toContain('.queue-toggle-btn');
    expect(compact).toContain("content: '⇩'");
    expect(phone).toContain('.app-brand > span');
    expect(phone).toContain('display: none');
    expect(narrow).toContain('padding-inline: 6px');
  });

  it('dimensiona os botões do cabeçalho proporcionalmente ao toggle', async () => {
    const css = await readFile(new URL('styles/main.css', root), 'utf8');
    const actions = css.match(/\.app-header__actions \.btn-sm \{[\s\S]*?\}/)?.[0] || '';
    expect(actions).toContain('min-height: 32px');
    expect(actions).toContain('padding: 6px 14px');
  });

  it('mantém a cor de texto dos links com aparência de botão no hover', async () => {
    const css = await readFile(new URL('styles/components/button.css', root), 'utf8');
    const secondaryHover = css.match(/\.ds-btn--secondary:hover,[\s\S]*?\.btn-secondary:hover \{[\s\S]*?\}/)?.[0] || '';
    expect(secondaryHover).toContain('color: var(--ds-text-primary)');
    const main = await readFile(new URL('styles/main.css', root), 'utf8');
    expect(main).toMatch(/\.queue-toggle-btn:hover,[\s\S]*?color: var\(--ds-text-primary\)/);
  });
});
