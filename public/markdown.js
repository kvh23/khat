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

function inline(parent, text) {
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(text.slice(offset, match.index));
    const [raw, code, label, href, bold, italic] = match;
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
    } else {
      parent.append(bold ? node("strong", bold) : node("em", italic));
    }
    offset = match.index + raw.length;
  }
  parent.append(text.slice(offset));
}

export function markdown(text, labels, report) {
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
        } catch {
          report("copyFailed");
        }
      });
      bar.append(node("span", fence[2] || labels.code), copy);
      const pre = node("pre");
      pre.tabIndex = 0;
      pre.append(node("code", value));
      block.append(bar, pre);
      fragment.append(block);
    } else if (heading) {
      paragraph = undefined;
      const title = node(`h${Math.min(6, heading[1].length + 1)}`);
      inline(title, heading[2]);
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
      inline(entry, item[3]);
      list.append(entry);
    } else if (line.startsWith("> ")) {
      paragraph = undefined;
      const quote = node("blockquote");
      inline(quote, line.slice(2));
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
      inline(paragraph, line);
    }
  }
  return fragment;
}
