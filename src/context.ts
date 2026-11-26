type Turn = { role: "user" | "assistant"; content: string };

const stop = new Set("what which when where can will like this about would have from their with your some hvad hvilken hvordan kan skal som ikke ville dette denne deres eller".split(" "));
const terms = (value: string) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
	.filter(word => word.length > 3 && !stop.has(word)));

export function contextWindow(history: Turn[]) {
	if (history.length <= 7) return { recent: history, summary: [] };
	const recent = history.slice(-6);
	const query = terms(recent[recent.length - 1].content);
	const summary = history.slice(0, -6).map((turn, position) => ({
		turn, position,
		score: [...terms(turn.content)].filter(term => query.has(term)).length,
	})).sort((a, b) => b.score - a.score || b.position - a.position)
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

export function calculate(prompt: string) {
	const expression = prompt.trim().replace(/^(?:calculate|beregn)\s*:\s*/i, "").replace(/[×÷−]/g, sign => ({ "×": "*", "÷": "/", "−": "-" }[sign]!));
	if (!/^[\d.()+*/\s-]{1,100}$/.test(expression) || !/[+*/-]/.test(expression)) return null;
	const tokens = expression.match(/\d+(?:\.\d+)?|\.\d+|[()+*/-]/g) ?? [];
	if (tokens.join("") !== expression.replace(/\s/g, "")) return null;
	let at = 0;
	function factor(): number {
		const token = tokens[at++];
		if (token === "(") {
			const value = sum();
			if (tokens[at++] !== ")") throw new Error("Parenthesis");
			return value;
		}
		if (token === "+" || token === "-") return (token === "-" ? -1 : 1) * factor();
		if (!token || !/^\d|^\.\d/.test(token)) throw new Error("Number expected");
		return Number(token);
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
