const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const MarkdownIt = require('markdown-it');

const renderer = require('../dist/cardlink.js').default({});
const manifest = require('../dist/manifest.json');
const bundle = fs.readFile(path.resolve(__dirname, '../dist/index.js'), 'utf8');
const resourceId = '1234567890abcdef'.repeat(2);
const faviconId = 'abcdef0123456789'.repeat(2);
const clipboardUrl = 'https://example.com/project?view=all&tab=about';
const coverUrl = 'https://example.com/projects/images/cover.png';
const faviconUrl = 'https://example.com/projects/icons/site.png';
const defaultFaviconUrl = 'https://example.com/favicon.ico';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');

function page(markup = `<meta content='images/cover.png' property='og:image'>
<meta property="og:title" content="Project &quot;[demo]&quot;">
<meta property="og:description" content="An &lt;example&gt; project">`) {
	const response = new Response(markup, { headers: { 'content-type': 'text/html; charset=utf-8' } });
	Object.defineProperty(response, 'url', { value: 'https://example.com/projects/demo' });
	return response;
}

async function start(api, fetch) {
	let script;
	vm.runInNewContext(await bundle, {
		URL, AbortController, setTimeout, clearTimeout, fetch, Buffer,
		require: name => api.require ? api.require(name) : assert.fail(`Loaded a desktop dependency on mobile: ${name}`),
		console: { warn() {} },
		joplin: { ...api, plugins: { ...api.plugins, register(value) { script = value; } } },
	});
	await script.onStart();
}

async function desktop(t, respond, {
	nextNote = () => ({ id: 'selected' }), clipboard = clipboardUrl,
	commandName = 'insertClipboardUrl', selection = () => '',
} = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autocard-test-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const calls = { contentScripts: [], requests: [], resources: [], inserted: [], menus: [], dialogs: [] };
	const commands = new Map();
	await start({
		versionInfo: async () => ({ platform: 'desktop' }),
		contentScripts: { register: async (...args) => calls.contentScripts.push(args) },
		workspace: { selectedNote: async () => nextNote() },
		clipboard: { readText: async () => clipboard },
		commands: {
			register: async cmd => { commands.set(cmd.name, cmd); },
			execute: async (name, options) => {
				if (name === 'selectedText') return selection();
				assert.equal(name, 'editor.execCommand');
				assert.equal(options.name, 'replaceSelection');
				calls.inserted.push(options.args[0]);
			},
		},
		views: {
			menuItems: { create: async (...args) => calls.menus.push(args) },
			dialogs: { showMessageBox: async message => calls.dialogs.push(message) },
		},
		plugins: { dataDir: async () => directory },
		require: name => require(name),
		data: { post: async (route, query, props, files) => {
			assert.equal(route.join('/'), 'resources');
			calls.resources.push({ mime: props.mime, title: props.title, bytes: await fs.readFile(files[0].path) });
			return { id: props.title.startsWith('autocard-favicon.') ? faviconId : resourceId };
		} },
	}, url => {
		calls.requests.push(url);
		return respond(url);
	});
	await commands.get(commandName).execute();
	assert.deepEqual(await fs.readdir(directory), [], 'temporary images must be cleaned up');
	return calls;
}

test('desktop downloads the cover and favicon once and inserts only local image references', async t => {
	const calls = await desktop(t, url => {
		if (url === clipboardUrl) return page(`<meta content='images/cover.png' property='og:image'>
<meta property="og:title" content="Project &quot;[demo]&quot;">
<meta property="og:description" content="An &lt;example&gt; project">
<link href='/icon.svg' rel='icon' type='image/svg+xml'>
<link rel='alternate icon' type='image/png' href='icons/site.png'>`);
		assert.ok([coverUrl, faviconUrl].includes(url));
		return new Response(png, { headers: { 'content-type': 'image/png' } });
	});
	assert.deepEqual(calls.requests, [clipboardUrl, coverUrl, faviconUrl]);
	assert.deepEqual(calls.resources.sort((a, b) => a.title.localeCompare(b.title)), [
		{ mime: 'image/png', title: 'autocard-cover.png', bytes: png },
		{ mime: 'image/png', title: 'autocard-favicon.png', bytes: png },
	]);
	assert.equal(calls.menus[0][3].accelerator, 'CmdOrCtrl+Alt+K');
	const [body] = calls.inserted;
	assert.ok(body.includes(`](:/${resourceId})`));
	assert.ok(body.includes(`![Site icon](:/${faviconId})`));
	assert.ok(!body.includes(coverUrl));
	assert.ok(!body.includes(faviconUrl));

	const markdown = new MarkdownIt({ html: true });
	const ordinary = markdown.render(body);
	assert.match(ordinary, /<blockquote>/);
	assert.match(ordinary, /Project &quot;\[demo\]&quot;/);
	assert.match(ordinary, /An &lt;example&gt; project/);
	assert.match(ordinary, /href="https:\/\/example\.com\/project\?view=all&amp;tab=about"/);
	assert.ok(ordinary.includes(`src=":/${resourceId}"`));
	assert.ok(ordinary.includes(`src=":/${faviconId}"`));
	assert.doesNotMatch(ordinary, /<img[^>]+src="https?:/);

	// The plugin must leave standard image rendering intact for Joplin to resolve the resource.
	markdown.renderer.rules.image = (tokens, index) => `<img data-resource="${tokens[index].attrGet('src')}">`;
	renderer.plugin(markdown);
	const styled = markdown.render(body);
	assert.match(styled, /<blockquote class="cardlink-portable">/);
	assert.match(styled, /<p class="cardlink-portable-cover">/);
	assert.match(styled, /<p class="cardlink-portable-footer">/);
	assert.ok(styled.includes(`data-resource=":/${resourceId}"`));
	assert.ok(styled.includes(`data-resource=":/${faviconId}"`));
	assert.equal(markdown.render('> Ordinary quote\n'), '<blockquote>\n<p>Ordinary quote</p>\n</blockquote>\n');
});

for (const [reason, image] of [
	['invalid image', () => new Response('not a png', { headers: { 'content-type': 'image/png' } })],
	['unsupported format', () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })],
	['oversized content-length', () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '6000000' } })],
	['oversized stream with no length', () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })],
	['network failure', () => { throw new Error('cover server offline'); }],
]) {
	test(`desktop still inserts a text card without remote images on ${reason}`, async t => {
		const calls = await desktop(t, url => url === clipboardUrl ? page() : url === coverUrl ? image() : new Response(null, { status: 404 }));
		assert.equal(calls.resources.length, 0);
		const markdown = new MarkdownIt({ html: true });
		renderer.plugin(markdown);
		const html = markdown.render(calls.inserted[0]);
		assert.match(html, /class="cardlink-portable"/);
		assert.match(html, /<a href=/);
		assert.doesNotMatch(html, /<img|cardlink-portable-cover/);
	});
}

function bitmapIcon() {
	// A 1x1 BGRA bitmap frame in an ICO, with an AND mask after the pixels.
	const bytes = Buffer.alloc(22 + 40 + 4 + 4);
	bytes.writeUInt16LE(1, 2);
	bytes.writeUInt16LE(1, 4);
	bytes[6] = bytes[7] = 1;
	bytes.writeUInt32LE(bytes.length - 22, 14);
	bytes.writeUInt32LE(22, 18);
	bytes.writeUInt32LE(40, 22);
	bytes.writeInt32LE(1, 26);
	bytes.writeInt32LE(2, 30);
	bytes.writeUInt16LE(1, 34);
	bytes.writeUInt16LE(32, 36);
	bytes[62] = bytes[65] = 255;
	return bytes;
}

test('classic favicon.ico bitmap is normalized to a portable PNG attachment', async t => {
	const calls = await desktop(t, url => {
		if (url === clipboardUrl) return page('<title>Example</title><link rel="icon" href="icons/site.png">');
		if (url === faviconUrl) return new Response(null, { status: 404 });
		assert.equal(url, defaultFaviconUrl);
		return new Response(bitmapIcon(), { headers: { 'content-type': 'image/x-icon' } });
	});
	assert.deepEqual(calls.requests, [clipboardUrl, faviconUrl, defaultFaviconUrl]);
	const [image] = calls.resources;
	assert.equal(image.title, 'autocard-favicon.png');
	assert.equal(image.mime, 'image/png');
	assert.deepEqual([...require('pngjs').PNG.sync.read(image.bytes).data], [0, 0, 255, 255]);
	assert.ok(calls.inserted[0].includes(`![Site icon](:/${faviconId})`));
	const markdown = new MarkdownIt({ html: true });
	renderer.plugin(markdown);
	const html = markdown.render(calls.inserted[0]);
	assert.match(html, /class="cardlink-portable-footer"/);
	assert.doesNotMatch(html, /cardlink-portable-cover/);
});

test('malformed ICO frame dimensions are rejected before decoding', async t => {
	const malformed = bitmapIcon();
	malformed.writeInt32LE(0x7fffffff, 26);
	const calls = await desktop(t, url => url === clipboardUrl ? page('<title>Example</title>')
		: new Response(malformed, { headers: { 'content-type': 'image/x-icon' } }));
	assert.equal(calls.resources.length, 0);
	assert.ok(!calls.inserted[0].includes('![Site icon]'));
});

const legacyBlock = [
	'```cardlink', 'url: https://example.com/project', 'title: Old project', 'description: Kept title and description',
	`image: ${coverUrl}`, `favicon: ${faviconUrl}`, '```', '',
].join('\n');

test('converting a selected legacy card uses stored assets and never rewrites the rest of the note', async t => {
	const calls = await desktop(t, url => {
		assert.ok([coverUrl, faviconUrl].includes(url));
		return new Response(png, { headers: { 'content-type': 'image/png' } });
	}, { commandName: 'autocardMakeSelectionOffline', selection: () => legacyBlock });
	assert.deepEqual(calls.requests, [coverUrl, faviconUrl]);
	const [body] = calls.inserted;
	assert.match(body, /Old project/);
	assert.match(body, /Kept title and description\n/);
	assert.ok(body.endsWith('\n'));
	assert.ok(body.includes(`](:/${resourceId})`));
	assert.ok(body.includes(`](:/${faviconId})`));
	assert.ok(!body.includes(coverUrl));
	assert.ok(!body.includes(faviconUrl));
});

test('legacy conversion refuses partial selections and selections containing more than one card', async t => {
	for (const selection of [legacyBlock.slice(0, -4), legacyBlock + legacyBlock]) {
		const calls = await desktop(t, () => assert.fail('unexpected fetch'), {
			commandName: 'autocardMakeSelectionOffline', selection: () => selection,
		});
		assert.equal(calls.inserted.length, 0);
		assert.equal(calls.dialogs.length, 1);
	}
});

test('legacy conversion does not replace the selection if it changed during a download', async t => {
	let selection = legacyBlock;
	const calls = await desktop(t, () => {
		selection = 'New selection';
		return new Response(png, { headers: { 'content-type': 'image/png' } });
	}, { commandName: 'autocardMakeSelectionOffline', selection: () => selection });
	assert.equal(calls.inserted.length, 0);
});

test('failed page fetch falls back to the original URL', async t => {
	const calls = await desktop(t, () => new Response(null, { status: 403 }));
	assert.deepEqual(calls.inserted, [clipboardUrl]);
	assert.equal(calls.dialogs.length, 1);
	assert.deepEqual(calls.requests, [clipboardUrl]);
});

test('plain clipboard text is inserted without fetching', async t => {
	const calls = await desktop(t, () => assert.fail('unexpected fetch'), { clipboard: 'plain text' });
	assert.deepEqual(calls.inserted, ['plain text']);
});

test('changing the selected note during the fetch does not insert a card into another note', async t => {
	let first = true;
	const calls = await desktop(t, () => page(), { nextNote: () => {
		const id = first ? 'original' : 'another';
		first = false;
		return { id };
	} });
	assert.deepEqual(calls.requests, [clipboardUrl]);
	assert.equal(calls.inserted.length, 0);
});

test('mobile startup registers only the renderer', async () => {
	assert.ok(manifest.platforms.includes('mobile'));
	const scripts = [];
	await start({
		versionInfo: async () => ({ platform: 'mobile' }),
		contentScripts: { register: async (...args) => scripts.push(args) },
	});
	assert.equal(scripts.length, 1);
	assert.equal(scripts[0][2], './cardlink.js');
	assert.deepEqual(renderer.assets(), [{ name: 'cardlink.css' }]);
});

test('legacy cardlink blocks keep their layout and treat metadata as text', () => {
	const markdown = new MarkdownIt({ html: true });
	renderer.plugin(markdown);
	const html = markdown.render([
		'```cardlink', 'url: https://example.com', 'image: https://example.com/cover.png',
		'favicon: https://example.com/icon.png', 'title: "Old"', 'description: <Example>', '```',
	].join('\n'));
	assert.match(html, /class="cardlink-card"/);
	assert.match(html, /src="https:\/\/example\.com\/cover\.png"/);
	assert.match(html, /src="https:\/\/example\.com\/icon\.png"/);
	assert.match(html, /&quot;Old&quot;/);
	assert.match(html, /&lt;Example&gt;/);
	assert.match(markdown.render('```js\nconst x = 1;\n```\n'), /class="language-js"/);
});
