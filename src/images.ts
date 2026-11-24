import joplin from 'api';

const maxCoverBytes = 5 * 1024 * 1024;
const maxFaviconBytes = 512 * 1024;
const rasterTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const iconTypes = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', 'image/icon', 'application/octet-stream', ''];

type AssetKind = 'cover' | 'favicon';
interface ImageAsset { bytes: Uint8Array; extension: string; mime: string }

function imageExtension(contentType: string, bytes: Uint8Array): string | undefined {
	const startsWith = (signature: number[], offset = 0) => signature.every((byte, i) => byte === bytes[offset + i]);
	switch (contentType) {
		case 'image/jpeg': return startsWith([0xff, 0xd8, 0xff]) ? 'jpg' : undefined;
		case 'image/png': return startsWith([137, 80, 78, 71, 13, 10, 26, 10]) ? 'png' : undefined;
		case 'image/gif': return startsWith([71, 73, 70, 56]) ? 'gif' : undefined;
		case 'image/webp': return startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8) ? 'webp' : undefined;
		default: return undefined;
	}
}

function convertIco(bytes: Uint8Array): Uint8Array | undefined {
	if (bytes.length < 6) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return undefined;
	const count = view.getUint16(4, true);
	const tableEnd = 6 + count * 16;
	if (count === 0 || count > 16 || tableEnd > bytes.length) return undefined;

	// The decoder reads frame sizes from the payload, not just the directory bytes.
	// Limit the actual dimensions and check frame boundaries before decoding.
	for (let offset = 6; offset < tableEnd; offset += 16) {
		const size = view.getUint32(offset + 8, true);
		const start = view.getUint32(offset + 12, true);
		if (start < tableEnd || size < 26 || start + size > bytes.length) return undefined;
		const png = imageExtension('image/png', bytes.subarray(start, start + size));
		const frame = png
			? { width: view.getUint32(start + 16), height: view.getUint32(start + 20) }
			: size >= 40 && view.getUint32(start, true) >= 40 && view.getUint32(start, true) <= size
				? { width: view.getInt32(start + 4, true), height: view.getInt32(start + 8, true) / 2 }
				: undefined;
		if (!frame || ![frame.width, frame.height].every(n => Number.isInteger(n) && n >= 1 && n <= 256)) return undefined;
	}

	// Load the codecs only when creating an ICO attachment on desktop.
	const decode = require('decode-ico');
	const icons = decode(bytes).sort((a, b) => b.width * b.height - a.width * a.height);
	const icon = icons[0];
	if (icon?.type === 'png') return icon.data;
	if (icon?.type === 'bmp') {
		const { PNG } = require('pngjs');
		return PNG.sync.write({ width: icon.width, height: icon.height, data: Buffer.from(icon.data) });
	}
	return undefined;
}

async function downloadImage(url: URL, kind: AssetKind): Promise<ImageAsset | undefined> {
	const favicon = kind === 'favicon';
	const maxBytes = favicon ? maxFaviconBytes : maxCoverBytes;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), favicon ? 3000 : 10000);
	try {
		const response = await fetch(url.href, { signal: controller.signal });
		const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		const mayBeIco = favicon && iconTypes.includes(mime);
		if (!response.ok || !response.body || (!rasterTypes.includes(mime) && !mayBeIco)) return undefined;
		if (Number(response.headers.get('content-length')) > maxBytes) return undefined;

		const chunks: Uint8Array[] = [];
		let size = 0;
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > maxBytes) return undefined;
			chunks.push(value);
		}

		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		const extension = imageExtension(mime, bytes);
		if (extension) return { bytes, extension, mime };
		if (mayBeIco) {
			for (const type of rasterTypes) {
				const extension = imageExtension(type, bytes);
				if (extension) return { bytes, extension, mime: type };
			}
			const png = convertIco(bytes);
			if (png) return { bytes: png, extension: 'png', mime: 'image/png' };
		}
		return undefined;
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}

export async function saveImage(url: URL, kind: AssetKind): Promise<string | undefined> {
	try {
		const image = await downloadImage(url, kind);
		if (!image) return undefined;

		const fs = joplin.require('fs-extra');
		const directory = await fs.mkdtemp(`${await joplin.plugins.dataDir()}/${kind}-`);
		try {
			const filename = `autocard-${kind}.${image.extension}`;
			const path = `${directory}/${filename}`;
			await fs.writeFile(path, image.bytes);
			const resource = await joplin.data.post(['resources'], null, { title: filename, mime: image.mime }, [{ path }]);
			return resource.id;
		} finally {
			await fs.remove(directory).catch(error => console.warn('AutoCard could not remove a temporary image:', error));
		}
	} catch (error) {
		console.warn(`AutoCard could not attach the ${kind}:`, error);
		return undefined;
	}
}

export async function saveFavicon(urls: URL[]): Promise<string | undefined> {
	const tried = new Set<string>();
	for (const url of urls) {
		if (tried.has(url.href)) continue;
		tried.add(url.href);
		const id = await saveImage(url, 'favicon');
		if (id) return id;
	}
	return undefined;
}
