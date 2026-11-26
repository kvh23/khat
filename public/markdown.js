export function webUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function inline(parent, text, sources = []) {
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[(\d{1,2})\]/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(text.slice(offset, match.index));
    const [raw, code, label, href, bold, italic, reference] = match;
    if (code) parent.append(node("code", code));
    else if (label) {
      const url = webUrl(href);
      if (!url) parent.append(raw);
      else {
        const link = node("a", label);
        link.href = url;
        link.rel = "noopener noreferrer";
        parent.append(link);
      }
    } else if (reference) {
      const source = sources[Number(reference) - 1];
      const url = source && webUrl(source.url);
      if (url) {
        const cite = node("a", raw, "citation");
        cite.href = url;
        cite.target = "_blank";
        cite.rel = "noopener noreferrer";
        cite.title = source.title;
        parent.append(cite);
      }
    } else {
      parent.append(bold ? node("strong", bold) : node("em", italic));
    }
    offset = match.index + raw.length;
  }
  parent.append(text.slice(offset));
}

function highlighted(value, language) {
  const code = node("code");
  if (!/^(?:js|jsx|mjs|cjs|javascript|ts|tsx|typescript|py|python|json|sh|bash|sql|java|c|cpp|csharp|cs|go|rust|rs|swift|css)$/i.test(language)) {
    code.textContent = value;
    return code;
  }
  const grammar = /(\/\/[^\n]*|#[^\n]*|-- [^\n]*|\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*'|\x60[^\x60]*\x60)|(\b(?:const|let|var|function|return|if|else|for|while|async|await|class|extends|import|export|from|try|catch|def|elif|except|lambda|select|join|where|insert|update|null|true|false|None|True|False)\b)|(\b\d+(?:\.\d+)?\b)/gi;
  let offset = 0;
  for (const match of value.matchAll(grammar)) {
    code.append(value.slice(offset, match.index));
    const kind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "number";
    code.append(node("span", match[0], `code-${kind}`));
    offset = match.index + match[0].length;
  }
  code.append(value.slice(offset));
  return code;
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

export function markdown(text, labels, report, sources = []) {
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph;
  let list;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*(`{3,}|~{3,})([\w+.#-]*)\s*$/.exec(line);
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (!item) list = undefined;
    if (line.includes("|") && lines[index + 1] && /^[|:\-\s]+$/.test(lines[index + 1])) {
      const headers = cells(line);
      const rule = cells(lines[index + 1]);
      if (headers.length > 1 && rule.length === headers.length && rule.every(cell => /^:?-{3,}:?$/.test(cell))) {
        paragraph = undefined;
        list = undefined;
        const wrapper = node("div", undefined, "table-scroll");
        wrapper.tabIndex = 0;
        const table = node("table");
        const row = table.createTHead().insertRow();
        for (const value of headers) {
          const cell = node("th");
          cell.scope = "col";
          inline(cell, value, sources);
          row.append(cell);
        }
        const body = table.createTBody();
        index++;
        while (lines[index + 1]?.includes("|") && cells(lines[index + 1]).length === headers.length) {
          const values = cells(lines[++index]);
          const entry = body.insertRow();
          values.forEach(value => inline(entry.insertCell(), value, sources));
        }
        wrapper.append(table);
        fragment.append(wrapper);
        continue;
      }
    }
    if (fence) {
      paragraph = undefined;
      const code = [];
      const ending = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++index < lines.length && !ending.test(lines[index])) code.push(lines[index]);
      const value = code.join("\n");
      const block = node("div", undefined, "code");
      const bar = node("div", undefined, "code-header");
      const copy = node("button", labels.copy);
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(value);
          report("copied");
          copy.textContent = labels.copied.replace(/[.!]$/, "");
          setTimeout(() => { copy.textContent = labels.copy; }, 1250);
        } catch {
          report("copyFailed");
        }
      });
      bar.append(node("span", fence[2] || labels.code), copy);
      const pre = node("pre");
      pre.tabIndex = 0;
      pre.append(highlighted(value, fence[2]));
      block.append(bar, pre);
      fragment.append(block);
    } else if (heading) {
      paragraph = undefined;
      const title = node(`h${Math.min(6, heading[1].length + 1)}`);
      inline(title, heading[2], sources);
      fragment.append(title);
    } else if (item) {
      paragraph = undefined;
      const tag = item[2] ? "OL" : "UL";
      if (list?.tagName !== tag) {
        list = node(tag.toLowerCase());
        if (item[2]) list.start = Number(item[2]);
        fragment.append(list);
      }
      const entry = node("li");
      inline(entry, item[3], sources);
      list.append(entry);
    } else if (line.startsWith("> ")) {
      paragraph = undefined;
      const quote = node("blockquote");
      inline(quote, line.slice(2), sources);
      fragment.append(quote);
    } else if (!line.trim()) {
      paragraph = undefined;
    } else {
      if (!paragraph) {
        paragraph = node("p");
        fragment.append(paragraph);
      } else {
        paragraph.append("\n");
      }
      inline(paragraph, line, sources);
    }
  }
  return fragment;
}
