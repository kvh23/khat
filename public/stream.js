export async function readReply(body, update) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
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
          if (!text) throw new Error("modelFailed");
          return text;
        }
        const event = JSON.parse(data);
        if (event.error) throw new Error("modelFailed");
        const delta = event.response ?? event.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          text += delta;
          update(text);
        }
      }
      if (done) throw new Error("modelFailed");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
