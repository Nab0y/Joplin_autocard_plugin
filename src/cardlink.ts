import { cardMarker, httpUrl, parseCardFields, siteIconAlt } from './card';

module.exports = {
	default: function(context) {
		return {
			plugin: function(markdownIt, _options) {
				// Style portable cards without replacing Joplin's normal image/link rendering.
				markdownIt.core.ruler.after('inline', 'joplin_autocard', ({ tokens }) => {
					for (let i = 0; i < tokens.length; i++) {
						const marker = tokens[i + 1];
						if (tokens[i].type !== 'blockquote_open' || marker?.type !== 'html_block' || marker.content.trim() !== cardMarker) continue;
						tokens[i].attrJoin('class', 'cardlink-portable');
						const firstParagraph = tokens[i + 2];
						if (firstParagraph?.type === 'paragraph_open' && tokens[i + 3]?.children?.some(child => child.type === 'image')) {
							firstParagraph.attrJoin('class', 'cardlink-portable-cover');
						}
						const level = tokens[i].level + 1;
						for (let j = i + 2; tokens[j]?.level >= level; j++) {
							if (tokens[j].type === 'paragraph_open' && tokens[j].level === level &&
								tokens[j + 1]?.children?.some(child => child.type === 'image' && child.content === siteIconAlt)) {
								tokens[j].attrJoin('class', 'cardlink-portable-footer');
							}
						}
					}
				});

				const escape = markdownIt.utils.escapeHtml;
				const escapedUrl = (value: string) => escape(httpUrl(value)?.href || '');
				const defaultRender = markdownIt.renderer.rules.fence || function(tokens, idx, options, env, self) {
					return self.renderToken(tokens, idx, options);
				};

				markdownIt.renderer.rules.fence = function(tokens, idx, options, env, self) {
					const token = tokens[idx];
					const info = token.info ? token.info.trim() : '';

					if (info === 'cardlink') {
						const metadata = parseCardFields(token.content);

						const url = escapedUrl(metadata['url']);
						if (!url) return defaultRender(tokens, idx, options, env, self);
						const title = escape(metadata['title'] || '');
						const description = escape(metadata['description'] || '');
						const host = escape(metadata['host'] || '');
						const favicon = escapedUrl(metadata['favicon']);
						const image = escapedUrl(metadata['image']);

						// Generate HTML for the card
						let html = '<div class="cardlink-container">';
						html += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="cardlink-card">`;

						// Left side - Image
						if (image) {
							html += '<div class="cardlink-image">';
							html += `<img src="${image}" alt="${title}" />`;
							html += '</div>';
						}

						// Right side - Content
						html += '<div class="cardlink-content">';

						if (title) {
							html += `<div class="cardlink-title">${title}</div>`;
						}

						if (description) {
							html += `<div class="cardlink-description">${description}</div>`;
						}

						if (host || favicon) {
							html += '<div class="cardlink-footer">';
							if (favicon) {
								html += `<img src="${favicon}" alt="" class="cardlink-favicon" />`;
							}
							if (host) {
								html += `<span class="cardlink-host">${host}</span>`;
							}
							html += '</div>';
						}

						html += '</div>'; // close cardlink-content
						html += '</a>'; // close cardlink-card
						html += '</div>'; // close cardlink-container

						return html;
					}

					return defaultRender(tokens, idx, options, env, self);
				};
			},
			assets: function() {
				return [
					{ name: 'cardlink.css' }
				];
			}
		};
	}
};
