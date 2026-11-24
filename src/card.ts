export const cardMarker = '<!-- joplin-autocard -->';
export const siteIconAlt = 'Site icon';

export interface CardMetadata {
	url: URL;
	title?: string;
	description?: string;
	image?: URL;
	favicons?: URL[];
}

export function httpUrl(value: string, base?: URL): URL | undefined {
	if (!value?.trim()) return undefined;
	try {
		const url = new URL(value.trim(), base);
		if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url;
	} catch {
		// Ignore malformed URLs.
	}
	return undefined;
}

function escapeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]<>()#+\-.!|~&]/g, '\\$&');
}

export function parseCardFields(content: string): Record<string, string> {
	const fields = Object.create(null);
	for (const line of content.split('\n')) {
		const separator = line.indexOf(':');
		if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
	}
	return fields;
}

export function defaultFavicon(url: URL): URL {
	return new URL('/favicon.ico', url);
}

export function parseLegacyCard(selection: string): CardMetadata | undefined {
	const lines = selection.trim().split(/\r?\n/);
	if (lines.length < 3 || !/^```cardlink[ \t]*$/.test(lines[0]) || lines[lines.length - 1] !== '```') return undefined;
	const content = lines.slice(1, -1);
	if (content.some(line => !/^(url|title|description|host|favicon|image):/.test(line))) return undefined;
	const fields = parseCardFields(content.join('\n'));
	const url = httpUrl(fields.url);
	if (!url) return undefined;
	const favicon = httpUrl(fields.favicon);
	return { url, title: fields.title, description: fields.description, image: httpUrl(fields.image), favicons: [favicon, defaultFavicon(url)].filter(Boolean) };
}

export function formatCard({ url, title, description }: CardMetadata, coverId?: string, faviconId?: string): string {
	// Keep a normal Markdown image token so Joplin handles attachment sync and rendering.
	const destination = `<${url.href.replace(/\\/g, '%5C').replace(/&/g, '&amp;')}>`;
	const host = url.hostname;
	const heading = title?.trim() || host;
	const blocks = [cardMarker];
	if (coverId && /^[a-f0-9]{32}$/i.test(coverId)) {
		blocks.push(`[![Preview: ${escapeText(heading)}](:/${coverId})](${destination})`);
	}
	blocks.push(`**[${escapeText(heading)}](${destination})**`);
	if (description?.trim()) blocks.push(escapeText(description));
	const icon = faviconId && /^[a-f0-9]{32}$/i.test(faviconId) ? `![${siteIconAlt}](:/${faviconId})` : '';
	const hostLabel = heading !== host ? `_${escapeText(host)}_` : '';
	if (icon || hostLabel) blocks.push([icon, hostLabel].filter(Boolean).join(' '));
	return blocks.map(block => `> ${block}`).join('\n>\n');
}
