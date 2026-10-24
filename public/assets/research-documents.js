(() => {
  'use strict';

  const definitions = [
    { key: 'mission', number: '01', label: 'Mission', description: 'What you sell and why it matters', file: 'mission', motif: 'compass' },
    { key: 'market', number: '02', label: 'Market', description: 'The market around your business', file: 'market', motif: 'map' },
    { key: 'idealClients', number: '03', label: 'Ideal customers', description: 'Who is most likely to buy', file: 'ideal-customers', motif: 'orbit' }
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const isReady = document => typeof document?.document === 'string' && document.document.trim().length > 0;
  const safeUrl = value => {
    if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const arrowIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg>';
  const downloadIcon = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v9m-3-3 3 3 3-3M3 12v3h12v-3"/></svg>';
  const checkIcon = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="m3 7 2.5 2.5L11 4"/></svg>';

  function motif(name) {
    const shapes = {
      compass: '<circle cx="40" cy="40" r="27"/><circle cx="40" cy="40" r="18" stroke-dasharray="1 5"/><path d="m48 24-3 21-21 11 11-21Z" class="cf-doc-motif-fill"/><path d="m35 35 10 10M40 6v7m0 54v7M6 40h7m54 0h7"/><circle cx="40" cy="40" r="2" class="cf-doc-motif-dot"/>',
      map: '<path d="m12 19 19-6 18 7 19-6v47l-19 6-18-7-19 6Z"/><path d="M31 13v47m18-40v47" stroke-opacity=".4"/><path d="M18 48c13 0 10-23 24-16s7 21 19 10" stroke-dasharray="3 4"/><circle cx="20" cy="48" r="3" class="cf-doc-motif-fill"/><path d="m56 23 8 0-4 8Z" class="cf-doc-motif-fill"/>',
      orbit: '<ellipse cx="40" cy="40" rx="31" ry="13" transform="rotate(-30 40 40)"/><ellipse cx="40" cy="40" rx="31" ry="13" transform="rotate(65 40 40)" stroke-opacity=".5"/><circle cx="40" cy="40" r="8" class="cf-doc-motif-fill"/><circle cx="63" cy="26" r="4" class="cf-doc-motif-dot"/><circle cx="30" cy="66" r="3" class="cf-doc-motif-dot"/>'
    };
    return '<svg class="cf-doc-motif" viewBox="0 0 80 80" aria-hidden="true">' + shapes[name] + '</svg>';
  }

  // Markdown is parsed into a small, explicit allowlist. Source HTML is always text.
  function inline(source, depth = 0, links = true) {
    const text = String(source ?? '');
    if (depth > 3) return esc(text);
    let result = '', index = 0;
    while (index < text.length) {
      const remaining = text.slice(index);
      if (remaining[0] === '\\' && remaining.length > 1 && /[\\`*_{}\[\]()#+.!|>-]/.test(remaining[1])) {
        result += esc(remaining[1]); index += 2; continue;
      }
      if (remaining[0] === '`') {
        const end = remaining.indexOf('`', 1);
        if (end > 1) { result += '<code>' + esc(remaining.slice(1, end)) + '</code>'; index += end + 1; continue; }
      }
      if (links && remaining[0] === '[') {
        const match = remaining.match(/^\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/);
        if (match) {
          const url = safeUrl(match[2]);
          result += url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + inline(match[1], depth + 1, false) + '</a>' : inline(match[1], depth + 1, false);
          index += match[0].length; continue;
        }
      }
      const marker = remaining.startsWith('**') ? '**' : remaining.startsWith('__') ? '__' : remaining[0] === '*' ? '*' : remaining[0] === '_' && (index === 0 || /\s/.test(text[index - 1])) ? '_' : null;
      if (marker) {
        const end = remaining.indexOf(marker, marker.length);
        if (end > marker.length) {
          const tag = marker.length === 2 ? 'strong' : 'em';
          result += '<' + tag + '>' + inline(remaining.slice(marker.length, end), depth + 1, links) + '</' + tag + '>';
          index += end + marker.length; continue;
        }
      }
      result += esc(text[index++]);
    }
    return result;
  }

  const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, '|'));
  const tableRule = line => {
    const cells = tableCells(line || '');
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  };
  const listMatch = line => line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  const blockStart = line => /^\s*(#{1,6}\s|```|~~~|>|[-+*]\s|\d+[.)]\s|(?:---+|\*\*\*+)\s*$)/.test(line || '');

  function blocks(markdown, grouped = true) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '', cursor = 0, sectionOpen = false, sectionCount = 0;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (!line.trim()) { cursor++; continue; }
      const fence = line.match(/^\s*(```+|~~~+)(.*)$/);
      if (fence) {
        const code = []; cursor++;
        while (cursor < lines.length && !lines[cursor].trim().startsWith(fence[1])) code.push(lines[cursor++]);
        if (cursor < lines.length) cursor++;
        html += '<pre class="cf-doc-code"><code>' + esc(code.join('\n')) + '</code></pre>'; continue;
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        if (grouped && heading[1].length <= 2) {
          if (sectionOpen) html += '</section>';
          sectionOpen = true; sectionCount++;
          html += '<section class="cf-doc-section"><div class="cf-doc-section-heading"><span aria-hidden="true">' + String(sectionCount).padStart(2, '0') + '</span><h4>' + inline(heading[2]) + '</h4></div>';
        } else {
          const level = Math.min(6, Math.max(4, heading[1].length + 2));
          html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
        }
        cursor++; continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += '<hr>'; cursor++; continue; }
      if (cursor + 1 < lines.length && tableRule(lines[cursor + 1]) && line.includes('|')) {
        const heads = tableCells(line), rules = tableCells(lines[cursor + 1]);
        const align = index => /^:.*:$/.test(rules[index] || '') ? 'center' : /:$/.test(rules[index] || '') ? 'right' : 'left';
        html += '<div class="cf-doc-table-wrap" tabindex="0" role="region" aria-label="Research table"><table><thead><tr>' + heads.map((head, index) => '<th scope="col" class="cf-doc-align-' + align(index) + '">' + inline(head) + '</th>').join('') + '</tr></thead><tbody>';
        cursor += 2;
        while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes('|')) {
          const cells = tableCells(lines[cursor++]);
          html += '<tr>' + heads.map((_, index) => '<td class="cf-doc-align-' + align(index) + '">' + inline(cells[index] || '') + '</td>').join('') + '</tr>';
        }
        html += '</tbody></table></div>'; continue;
      }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (cursor < lines.length && /^\s*>/.test(lines[cursor])) quote.push(lines[cursor++].replace(/^\s*>\s?/, ''));
        html += '<blockquote>' + blocks(quote.join('\n'), false) + '</blockquote>'; continue;
      }
      const firstList = listMatch(line);
      if (firstList) {
        const ordered = /^\d/.test(firstList[2]), tag = ordered ? 'ol' : 'ul', baseIndent = firstList[1].length;
        const start = ordered ? Math.min(9999, Math.max(1, Number.parseInt(firstList[2], 10))) : 1;
        html += '<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>';
        while (cursor < lines.length) {
          const item = listMatch(lines[cursor]);
          if (!item || item[1].length !== baseIndent || /^\d/.test(item[2]) !== ordered) break;
          let content = item[3]; cursor++;
          const children = [];
          while (cursor < lines.length && lines[cursor].trim() && /^\s+/.test(lines[cursor]) && (lines[cursor].match(/^\s*/)[0].length > baseIndent)) children.push(lines[cursor++].slice(baseIndent + 2));
          const task = content.match(/^\[([ xX])\]\s+(.*)$/);
          html += '<li' + (task ? ' class="cf-doc-check-item"' : '') + '>' + (task ? '<span class="cf-doc-check" aria-label="' + (task[1].trim() ? 'Complete' : 'Not complete') + '">' + (task[1].trim() ? checkIcon : '') + '</span>' + inline(task[2]) : inline(content)) + (children.length ? blocks(children.join('\n'), false) : '') + '</li>';
        }
        html += '</' + tag + '>'; continue;
      }
      const paragraph = [line.trim()]; cursor++;
      while (cursor < lines.length && lines[cursor].trim() && !blockStart(lines[cursor]) && !(cursor + 1 < lines.length && tableRule(lines[cursor + 1]))) paragraph.push(lines[cursor++].trim());
      html += '<p>' + inline(paragraph.join(' ')) + '</p>';
    }
    if (sectionOpen) html += '</section>';
    return html;
  }

  function sourceList(document) {
    const raw = Array.isArray(document?.citations) && document.citations.length ? document.citations : document?.sources;
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).reduce((all, source) => {
      const url = safeUrl(typeof source === 'string' ? source : source?.url);
      if (!url || seen.has(url)) return all;
      seen.add(url);
      const host = new URL(url).hostname.replace(/^www\./, '');
      all.push({ url, host, title: String(source?.title || source?.label || host) });
      return all;
    }, []);
  }

  function paper(document, definition) {
    const presentation = document.presentation && typeof document.presentation === 'object' ? document.presentation : {};
    let markdown = document.document.replace(/^\uFEFF/, '').trim();
    const firstHeading = markdown.match(/^#\s+([^\n]+)\n?/);
    const title = String(presentation.title || firstHeading?.[1] || definition.label);
    if (firstHeading) markdown = markdown.slice(firstHeading[0].length).trim();
    const highlights = Array.isArray(presentation.highlights) ? presentation.highlights.filter(item => item && (item.label || item.text)).slice(0, 4) : [];
    const language = /^[a-z]{2,3}(?:-[a-zA-Z]{2,8})*$/.test(document.languageCode || '') ? document.languageCode : null;
    const references = sourceList(document);
    return '<article class="cf-doc-paper"' + (language ? ' lang="' + esc(language) + '"' : '') + '><div class="cf-doc-paper-top"><span class="cf-doc-edition"><span>' + definition.number + '</span> ' + definition.label + '</span><button type="button" class="cf-doc-download" data-cf-doc-download="' + definition.key + '">' + downloadIcon + '<span>Save document</span></button></div><header class="cf-doc-paper-header"><div class="cf-doc-paper-mark" aria-hidden="true">' + motif(definition.motif) + '</div><h3>' + inline(title, 0, false) + '</h3>' + (presentation.subtitle ? '<p class="cf-doc-lede">' + inline(presentation.subtitle) + '</p>' : '') + '</header>' + (highlights.length ? '<dl class="cf-doc-highlights">' + highlights.map(item => '<div><dt>' + esc(item.label) + '</dt><dd>' + inline(item.text) + '</dd></div>').join('') + '</dl>' : '') + '<div class="cf-doc-prose">' + blocks(markdown) + '</div>' + (references.length ? '<footer class="cf-doc-references"><div class="cf-doc-reference-heading"><h4>Sources</h4><span>' + references.length + ' reference' + (references.length === 1 ? '' : 's') + '</span></div><div class="cf-doc-source-list">' + references.map((source, index) => '<a class="cf-doc-source" href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer"><span class="cf-doc-source-number">' + String(index + 1).padStart(2, '0') + '</span><span class="cf-doc-source-text"><strong>' + esc(source.title) + '</strong><small>' + esc(source.host) + '</small></span>' + arrowIcon + '</a>').join('') + '</div></footer>' : '') + '</article>';
  }

  function pending(definition) {
    return '<div class="cf-doc-pending"><div class="cf-doc-pending-art" aria-hidden="true"><div class="cf-doc-pending-sheet">' + motif(definition.motif) + '<i></i><i></i><i></i></div></div><span class="cf-doc-pending-label">' + definition.number + ' / ' + definition.label + '</span><h3>A little more research.</h3><p>This document will appear here as soon as this part of your research is complete.</p></div>';
  }

  function render(data = {}, activeKey = 'mission') {
    const selected = definitions.find(definition => definition.key === activeKey) || definitions[0];
    return '<section class="cf-documents" aria-label="Your research documents"><div class="cf-doc-tabs" role="tablist" aria-label="Research documents">' + definitions.map(definition => {
      const ready = isReady(data?.[definition.key]), active = selected.key === definition.key;
      return '<button type="button" role="tab" class="cf-doc-tab ' + (ready ? 'is-ready' : 'is-pending') + '" id="cf-doc-tab-' + definition.key + '" data-cf-doc-select="' + definition.key + '" aria-controls="cf-doc-panel" aria-selected="' + active + '" tabindex="' + (active ? '0' : '-1') + '"><span class="cf-doc-tab-top"><span class="cf-doc-tab-number">' + definition.number + '</span><span class="cf-doc-tab-state">' + (ready ? checkIcon + 'Ready' : 'Coming up') + '</span></span><span class="cf-doc-tab-art">' + motif(definition.motif) + '</span><strong>' + definition.label + '</strong><span class="cf-doc-tab-description">' + definition.description + '</span></button>';
    }).join('') + '</div><div id="cf-doc-panel" class="cf-doc-panel" data-cf-doc-active="' + selected.key + '" role="tabpanel" aria-labelledby="cf-doc-tab-' + selected.key + '" tabindex="0">' + (isReady(data?.[selected.key]) ? paper(data[selected.key], selected) : pending(selected)) + '</div></section>';
  }

  const bindings = new WeakMap();
  function bind(container, data = {}, onSelect) {
    if (!container?.addEventListener) return;
    bindings.get(container)?.abort();
    const controller = new AbortController(); bindings.set(container, controller);
    const select = (key, focus) => {
      if (!definitions.some(definition => definition.key === key)) return;
      if (typeof onSelect === 'function') onSelect(key);
      else { container.innerHTML = render(data, key); bind(container, data); }
      if (focus) requestAnimationFrame(() => (container.isConnected ? container : document).querySelector('[data-cf-doc-select="' + key + '"]')?.focus());
    };
    container.addEventListener('click', event => {
      const button = event.target.closest?.('[data-cf-doc-select], [data-cf-doc-download]');
      if (!button || !container.contains(button)) return;
      if (button.dataset.cfDocSelect) { select(button.dataset.cfDocSelect, false); return; }
      const definition = definitions.find(item => item.key === button.dataset.cfDocDownload);
      if (!definition || !isReady(data?.[definition.key])) return;
      const blob = new Blob([data[definition.key].document], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'clientflock-' + definition.file + '.md';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { signal: controller.signal });
    container.addEventListener('keydown', event => {
      const tab = event.target.closest?.('[data-cf-doc-select]');
      if (!tab || !container.contains(tab)) return;
      const index = definitions.findIndex(definition => definition.key === tab.dataset.cfDocSelect);
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % definitions.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + definitions.length - 1) % definitions.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = definitions.length - 1;
      else return;
      event.preventDefault(); select(definitions[next].key, true);
    }, { signal: controller.signal });
    return () => { controller.abort(); if (bindings.get(container) === controller) bindings.delete(container); };
  }

  window.ClientFlockDocuments = Object.freeze({ render, bind });
})();
