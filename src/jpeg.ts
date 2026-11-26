// Read JPEG frame dimensions without decoding pixels. Input is already byte-bounded.
export function compactJpeg(base64: string, maxSide: number) {
	if (!/^\/9j\/[a-z0-9+/]+={0,2}$/i.test(base64)) return false;
	let bytes: string;
	try { bytes = atob(base64); } catch { return false; }
	if (bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) return false;
	const word = (at: number) => bytes.charCodeAt(at) * 256 + bytes.charCodeAt(at + 1);
	for (let offset = 2; offset + 4 < bytes.length;) {
		if (bytes.charCodeAt(offset++) !== 255) return false;
		while (bytes.charCodeAt(offset) === 255) offset++;
		const marker = bytes.charCodeAt(offset++);
		const length = word(offset);
		if (length < 2 || offset + length > bytes.length) return false;
		if ([192, 193, 194].includes(marker)) {
			const height = word(offset + 3);
			const width = word(offset + 5);
			return length >= 8 && width > 0 && height > 0 && width <= maxSide && height <= maxSide;
		}
		if (marker === 218) return false;
		offset += length;
	}
	return false;
}
