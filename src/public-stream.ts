// Retain only public answer tokens. Normalize both documented Cloudflare SSE shapes.
export function publicStream(upstream: ReadableStream) {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = "";
	let held = "";
	let hidden = false;
	let finished = false;
	const openTag = "<think>";
	const closeTag = "</think>";

	function visible(text: string, flush = false) {
		let remaining = held + text;
		held = "";
		let result = "";
		while (remaining) {
			const tag = hidden ? closeTag : openTag;
			const lower = remaining.toLowerCase();
			const found = lower.indexOf(tag);
			if (found >= 0) {
				if (!hidden) result += remaining.slice(0, found);
				remaining = remaining.slice(found + tag.length);
				hidden = !hidden;
				continue;
			}
			let overlap = Math.min(tag.length - 1, remaining.length);
			while (overlap && !tag.startsWith(lower.slice(-overlap))) overlap--;
			if (!flush && overlap) held = remaining.slice(-overlap);
			if (!hidden) result += held ? remaining.slice(0, -overlap) : remaining;
			break;
		}
		return result;
	}

	const frame = (value: string, controller: TransformStreamDefaultController<Uint8Array>) => {
		if (finished) return;
		const data = value.split("\n").filter(line => line.startsWith("data:"))
			.map(line => line.slice(5).trimStart()).join("\n");
		if (!data) return;
		if (data === "[DONE]") {
			const tail = visible("", true);
			if (tail) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: tail })}\n\n`));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			finished = true;
			return;
		}
		const event = JSON.parse(data);
		if (event.error) throw new Error("Upstream generation failed");
		const delta = event.response ?? event.choices?.[0]?.delta?.content;
		if (typeof delta !== "string") return;
		const response = visible(delta);
		if (response) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response })}\n\n`));
	};

	return upstream.pipeThrough(new TransformStream({
		transform(chunk: Uint8Array, controller) {
			buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
			let end;
			while ((end = buffer.indexOf("\n\n")) !== -1) {
				frame(buffer.slice(0, end), controller);
				buffer = buffer.slice(end + 2);
			}
			if (buffer.length > 131_072) throw new Error("Upstream event too large");
		},
		flush(controller) {
			frame((buffer + decoder.decode()).replace(/\r\n/g, "\n"), controller);
		},
	}));
}
