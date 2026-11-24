# Joplin Auto Card Link Plugin

This is my first Joplin plugin. I have created it with the intention of learning how to create plugins for Joplin, and I hope it can be useful for others as well.
The development has been done using the [Joplin Plugin Generator](https://github.com/laurent22/joplin/tree/dev/packages/generator-joplin) and the help of [Cline](https://cline.bot/).

The plugin does the same as the "[Auto Card Link plugin](https://github.com/nekoshita/obsidian-auto-card-link)"  for Obsidian, which I have been using for a while and found it very useful.

## Create a card on desktop

1. Copy a web URL and put the cursor in the Markdown editor.
2. Press `Ctrl+Alt+K` (`Cmd+Option+K` on macOS), or use **Tools > Insert clipboard URL with metadata at cursor**.

If you upgraded from 1.0 and Joplin kept the old `Ctrl+Shift+L` binding, change it in **Settings > Keyboard Shortcuts**. The old combination conflicts with Joplin's shortcut for focusing the note list.

New cards use ordinary Markdown. The plugin downloads the cover and site icon when creating the card and attaches them as Joplin resources. The destination link is the only external dependency, and is opened only when clicked. Previewing a saved card does not contact the website.

PNG, JPEG, GIF and WebP covers up to 5 MiB are supported. Favicons up to 512 KiB are supported in the same formats and in ICO (stored as PNG). If the site supplies only an unsupported icon (such as SVG) or the download fails, the card is saved without that image rather than loading it remotely.

## Mobile and existing cards

- New cards show a clickable title and the attached cover and favicon in the Markdown viewer, even without the plugin. Both images are available offline once the attachments have been downloaded by Joplin.
- The plugin adds card styling on desktop and Android. The Android build is view-only; create cards on desktop and sync the notes. Install the `.jpl` under **Configuration > Plugins > Advanced settings > Install from file**. Joplin on iOS only allows recommended plugins; use the plain Markdown view on iOS.
- Existing `cardlink` blocks still render with their original images until converted. To make a legacy card offline, select one entire `cardlink` block (including the opening and closing backticks) in the desktop Markdown editor, then use **Tools > Make selected AutoCard available offline**. Only the selected block is replaced. If an old image is unavailable or unsupported, it is omitted. No notes are converted automatically.

## Development

Run `npm ci` and `npm test`. The build archive is `publish/joplin.plugin.autocard.jpl`.

## Original `cardlink` format

The original source looks like this:

![Screenshot of the source in Markdown](./images/joplin-autocard-source.png)
 
And the result looks like this:

![Screenshot of the Link Card created by the plugin](./images/joplin-autocard-card.png)

This Plugin is still in development, and I am open to any suggestions or feedback. If you have any ideas on how to improve the plugin, please feel free to share them with me.
