type Turn = { role: "user" | "assistant"; content: string };

const stop = new Set("what which when where can will like this about would have from their with your some hvad hvilken hvordan kan skal som ikke ville dette denne deres eller".split(" "));
export const terms = (value: string) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
	.filter(word => word.length > 3 && !stop.has(word)));

export function contextWindow(history: Turn[]) {
	if (history.length <= 7) return { recent: history, summary: [] };
	const recent = history.slice(-6);
	const query = terms(recent[recent.length - 1].content);
	const summary = history.slice(0, -6).map((turn, position) => ({
		turn, position,
		score: [...terms(turn.content)].filter(term => query.has(term)).length,
	})).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.position - a.position)
		.slice(0, 4).sort((a, b) => a.position - b.position)
		.map(({ turn, score }) => {
			const sentences = turn.content.match(/[^.!?\n]+[.!?]?/g) ?? [turn.content];
			const first = sentences[0];
			const relevant = score && sentences.find(sentence => [...terms(sentence)].some(word => query.has(word)));
			return { role: turn.role, excerpt: [first, relevant && relevant !== first ? relevant : ""]
				.filter(Boolean).join(" ").trim().slice(0, 420) };
		});
	return { recent, summary };
}

type Attachment = { name: string; text: string };

export function documentContext(files: Attachment[], prompt: string) {
	const query = terms(prompt);
	return files.map(file => {
		if (file.text.length <= 3600 || query.size === 0) return file;
		const chunks = file.text.match(/[\s\S]{1,900}(?:\n|$)|[\s\S]{1,900}/g) ?? [];
		const ranked = chunks.map((text, index) => ({
			text, index, score: [...terms(text)].filter(word => query.has(word)).length,
		})).filter(chunk => chunk.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
		if (!ranked.length) return file;
		const selected = ranked.slice(0, 3).sort((a, b) => a.index - b.index);
		return { name: file.name, excerpts: selected.map(({ text, index }) => ({ section: index + 1, text })) };
	});
}

export function calculate(prompt: string) {
	const expression = prompt.trim().replace(/^(?:calculate|beregn|hvad er|what is)\b\s*:?\s*/i, "").replace(/\?$/, "").replace(/(\d),(?=\d)/g, "$1.").replace(/[×÷−]/g, sign => ({ "×": "*", "÷": "/", "−": "-" }[sign]!))
		.replace(/√\s*\(/g, "sqrt(").replace(/%\s+(?:of|af)\s+/gi, "% * ");
	if (!/^[\d.()+*/^%sqrt\s-]{1,100}$/.test(expression) || !/[+*/^%-]|sqrt/.test(expression)) return null;
	const tokens = expression.match(/\d+(?:\.\d+)?|\.\d+|sqrt|[()+*/^%-]/g) ?? [];
	if (tokens.join("") !== expression.replace(/\s/g, "")) return null;
	let at = 0;
	function atom(): number {
		const token = tokens[at++];
		if (token === "sqrt") {
			if (tokens[at] !== "(") throw new Error("Root requires parentheses");
			return Math.sqrt(atom());
		}
		if (token === "(") {
			const value = sum();
			if (tokens[at++] !== ")") throw new Error("Parenthesis");
			return value;
		}
		if (!token || !/^\d|^\.\d/.test(token)) throw new Error("Number expected");
		return Number(token);
	}
	function factor(): number {
		const token = tokens[at];
		if (token === "+" || token === "-") {
			at++;
			return (token === "-" ? -1 : 1) * factor();
		}
		let value = atom();
		if (tokens[at] === "%") {
			at++;
			value /= 100;
		}
		if (tokens[at] === "^") {
			at++;
			value **= factor();
		}
		if (!Number.isFinite(value)) throw new Error("Nonfinite value");
		return value;
	}
	function product() {
		let value = factor();
		while (tokens[at] === "*" || tokens[at] === "/") value = tokens[at++] === "*" ? value * factor() : value / factor();
		return value;
	}
	function sum() {
		let value = product();
		while (tokens[at] === "+" || tokens[at] === "-") value = tokens[at++] === "+" ? value + product() : value - product();
		return value;
	}
	try {
		const value = sum();
		return at === tokens.length && Number.isFinite(value) ? { expression, value: Number(value.toPrecision(14)) } : null;
	} catch {
		return null;
	}
}
