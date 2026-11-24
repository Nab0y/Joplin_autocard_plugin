import { CardMetadata, defaultFavicon, httpUrl } from './card';

const entities: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", nbsp: ' ' };

function decodeText(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|lt|gt|apos|nbsp);/gi, (match, entity: string) => {
		entity = entity.toLowerCase();
		if (!entity.startsWith('#')) return entities[entity];
		const hex = entity.startsWith('#x');
		const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	}).trim();
}

function readAttributes(tag: string): Map<string, string> {
	const attributes = new Map<string, string>();
	const attribute = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
	let match: RegExpExecArray | null;
	while ((match = attribute.exec(tag))) {
		attributes.set(match[1].toLowerCase(), decodeText(match[2] ?? match[3] ?? match[4]));
	}
	return attributes;
}

function charsetFromContentType(value: string): string | undefined {
	const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i.exec(value);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

function decoderFor(label?: string): TextDecoder | undefined {
	if (!label?.trim()) return undefined;
	try {
		return new TextDecoder(label);
	} catch {
		return undefined;
	}
}

function decoderFromHtml(bytes: Uint8Array): TextDecoder | undefined {
	// Encoding declarations are ASCII, so only inspect a short prefix before decoding the document.
	const prefix = new TextDecoder().decode(bytes.subarray(0, 4096));
	const pattern = /<!--[\s\S]*?(?:-->|$)|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
	let tag: RegExpExecArray | null;
	while ((tag = pattern.exec(prefix))) {
		if (tag[0].startsWith('<!--')) continue;
		const attributes = readAttributes(tag[0]);
		const legacy = attributes.get('http-equiv')?.toLowerCase() === 'content-type';
		const label = attributes.get('charset') ?? (legacy ? charsetFromContentType(attributes.get('content') || '') : undefined);
		const decoder = decoderFor(label);
		if (decoder) return decoder.encoding.startsWith('utf-16') ? new TextDecoder() : decoder;
	}
	return undefined;
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
	// Match browser precedence: BOM, then HTTP charset, then the HTML declaration.
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes);
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	return (decoderFor(charsetFromContentType(contentType)) ?? decoderFromHtml(bytes) ?? new TextDecoder()).decode(bytes);
}

function parseMetadata(html: string, url: URL, pageUrl: URL): CardMetadata {
	const tags = new Map<string, string>();
	const favicons: URL[] = [];
	const tagPattern = /<(meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
	let tag: RegExpExecArray | null;
	while ((tag = tagPattern.exec(html))) {
		const attributes = readAttributes(tag[0]);
		if (tag[1].toLowerCase() === 'link') {
			const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) || [];
			if (rel.includes('icon')) {
				const icon = httpUrl(attributes.get('href'), pageUrl);
				const type = attributes.get('type')?.toLowerCase();
				if (icon && type !== 'image/svg+xml' && !/\.svgz?$/i.test(icon.pathname)) favicons.push(icon);
			}
			continue;
		}
		const key = (attributes.get('property') || attributes.get('name'))?.toLowerCase();
		const value = attributes.get('content');
		if (key && value && !tags.has(key)) tags.set(key, value);
	}

	const pageTitle = html.match(/<title(?:\s[^>]*)?>([^<]*)<\/title>/i)?.[1];
	const image = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']
		.map(key => httpUrl(tags.get(key) || '', pageUrl)).find(Boolean);
	return {
		url,
		title: tags.get('og:title') || tags.get('twitter:title') || (pageTitle ? decodeText(pageTitle) : undefined),
		description: tags.get('og:description') || tags.get('twitter:description') || tags.get('description'),
		image,
		favicons: [...favicons.slice(0, 2), defaultFavicon(pageUrl)],
	};
}

export async function fetchMetadata(url: URL): Promise<CardMetadata | undefined> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10000);
	try {
		const response = await fetch(url.href, { signal: controller.signal });
		const contentType = response.headers.get('content-type') || '';
		if (!response.ok || !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) return undefined;
		const bytes = new Uint8Array(await response.arrayBuffer());
		return parseMetadata(decodeHtml(bytes, contentType), url, httpUrl(response.url) || url);
	} catch (error) {
		console.warn('AutoCard could not fetch page metadata:', error);
		return undefined;
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}
