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
		if (!response.ok || !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '')) return undefined;
		return parseMetadata(await response.text(), url, httpUrl(response.url) || url);
	} catch (error) {
		console.warn('AutoCard could not fetch page metadata:', error);
		return undefined;
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}
