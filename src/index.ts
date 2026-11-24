import joplin from 'api';
import { ContentScriptType, MenuItemLocation } from 'api/types';
import { CardMetadata, formatCard, httpUrl, parseLegacyCard } from './card';
import { saveFavicon, saveImage } from './images';
import { fetchMetadata } from './metadata';

async function makeOfflineCard(metadata: CardMetadata): Promise<string> {
	const [coverId, faviconId] = await Promise.all([
		metadata.image ? saveImage(metadata.image, 'cover') : undefined,
		saveFavicon(metadata.favicons || []),
	]);
	return formatCard(metadata, coverId, faviconId);
}

function selectedText(): Promise<string> {
	return joplin.commands.execute('selectedText');
}

async function replaceSelection(text: string): Promise<void> {
	await joplin.commands.execute('editor.execCommand', { name: 'replaceSelection', args: [text] });
}

joplin.plugins.register({
	onStart: async () => {
		await joplin.contentScripts.register(ContentScriptType.MarkdownItPlugin, 'cardlink', './cardlink.js');

		// Mobile only renders cards: the clipboard and menu APIs are desktop-only.
		if ((await joplin.versionInfo()).platform !== 'desktop') return;

		await joplin.commands.register({
			name: 'insertClipboardUrl',
			label: 'Insert clipboard URL with metadata at cursor',
			iconName: 'fas fa-link',
			execute: async () => {
				const note = await joplin.workspace.selectedNote();
				if (!note) return;

				const clipboardText = await joplin.clipboard.readText();
				if (!clipboardText) return;
				const url = httpUrl(clipboardText);
				let text = clipboardText;

				if (url) {
					const metadata = await fetchMetadata(url);
					if ((await joplin.workspace.selectedNote())?.id !== note.id) return;

					if (metadata) {
						text = `\n\n${await makeOfflineCard(metadata)}\n\n`;
					} else {
						await joplin.views.dialogs.showMessageBox('Failed to fetch metadata from URL. The URL will be inserted as plain text.');
					}
				}

				if ((await joplin.workspace.selectedNote())?.id !== note.id) return;
				await replaceSelection(text);
			},
		});

		await joplin.commands.register({
			name: 'autocardMakeSelectionOffline',
			label: 'Make selected AutoCard available offline',
			execute: async () => {
				const note = await joplin.workspace.selectedNote();
				if (!note) return;
				const selection = await selectedText();
				const metadata = typeof selection === 'string' ? parseLegacyCard(selection) : undefined;
				if (!metadata) {
					await joplin.views.dialogs.showMessageBox('Select one complete cardlink block in the Markdown editor, including its opening and closing backticks.');
					return;
				}
				const card = await makeOfflineCard(metadata);
				if ((await joplin.workspace.selectedNote())?.id !== note.id || await selectedText() !== selection) return;
				const leading = selection.match(/^\s*/)[0];
				const trailing = selection.match(/\s*$/)[0];
				await replaceSelection(`${leading}${card}${trailing}`);
			},
		});

		await joplin.views.menuItems.create('insertClipboardUrlMenuItem', 'insertClipboardUrl', MenuItemLocation.Tools, { accelerator: 'CmdOrCtrl+Alt+K' });
		await joplin.views.menuItems.create('autocardMakeSelectionOfflineMenuItem', 'autocardMakeSelectionOffline', MenuItemLocation.Tools);
	},
});
