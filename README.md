# Chat Copier 1.1.0

Updated from the supplied Chat Copier 1.0.0 archive.

## Install using a repository URL

Upload the contents of this folder to your extension repository (manifest.json,
index.js, style.css and README.md at repository root). Remove the old lowercase
readme.md from the repository: it collides with README.md on Windows.
Install your repository URL through Extensions > Install Extension.
The original author's URL will not install these changes.

If replacing an already installed local copy, close the app, back up its extension
folder, and replace the files inside that same folder with these files. Restart
the app. Do not install a second copy alongside the old extension.
This ZIP is a source package; ZIP import support depends on your app.

## Controls

- Select ON/OFF adds/removes message checkboxes. Turning OFF clears selection.
- Copy selected always copies; Download selected always downloads.
- Select 50, Select 100, and custom Last N select a fixed set of messages.
- From # / To # use zero-based chat message IDs, inclusive (0 is the first message).
- 10 copies the latest ten eligible messages. 30 TXT and All TXT download exports.
- Original Markdown preserves stored message text and uses .md for downloads.
- Clean plain text uses the host Markdown converter when available. If unavailable,
  it preserves original text rather than risk removing content.
- Include Names preserves persona/character names. Timestamps remain optional.
- System messages are excluded by default; enable them in settings if needed.

## Reliability

Selections track message objects rather than shifting array positions and clear
when chat identity or chat array changes. If the host rebuilds message objects,
selection clears conservatively; select again. Deleted messages are dropped.
Message edits use current stored text; newly appended messages are not added to
an existing selection. Wait until generation finishes before exporting.
Exports use chat data and do not scrape the displayed final message.
Clipboard listeners are removed even after failed copy attempts.
No chat text is logged. Automatic updates are disabled for this modified package.

## Validation

checkout my sillytavern casual romance preset : https://mypapercraft.net/sillytavern-preset-for-office-romance-casual-lifestyle-roleplay

JavaScript syntax and isolated regression checks passed for selection after new
messages, deletion, chat switching, system filtering, persona names, empty counts,
and clipboard listener cleanup. Not tested in a live SillyTavern/TauriTavern app;
clipboard, downloads, and theme layout still need a check on your device.
