function publicReply(text) {
  const withoutReasoning = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
  const partialStart = /<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i;
  return withoutReasoning.replace(partialStart, "");
}

export async function readReply(body, update) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
    let lastReply = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() + "\n\n" : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const data = buffer.slice(0, end).split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        buffer = buffer.slice(end + 2);
        if (!data) continue;
        if (data === "[DONE]") {
          const reply = publicReply(text).trimStart();
          if (!reply) throw new Error("modelFailed");
          return reply;
        }
        const event = JSON.parse(data);
        if (event.error) throw new Error("modelFailed");
        const delta = event.response ?? event.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          text += delta;
          const reply = publicReply(text);
          if (reply !== lastReply) {
            lastReply = reply;
            update(reply);
          }
        }
      }
      if (done) throw new Error("modelFailed");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
