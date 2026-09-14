# Chat Copier 1.1.1

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
- Select 50 and Select 100 select a fixed set of messages. The custom Last N input has been removed.
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

JavaScript syntax and isolated regression checks passed for selection after new
messages, deletion, chat switching, system filtering, persona names, empty counts,
and clipboard listener cleanup. Not tested in a live SillyTavern/TauriTavern app;
clipboard, downloads, and theme layout still need a check on your device.

## 1.1.1 selection update

Use From # 100 / To # 230 to select that inclusive range (131 messages before
system/empty-message filtering). The numbers match chat message IDs, starting at 0.
Existing 10/30/50/100 shortcuts are retained.

Inline checkboxes apply to displayed messages. Scroll/load older messages to use
them inline, or choose Browse messages to tick for a scrollable checklist drawn
from all available chat data, including messages not displayed on screen. That
list shows a message number, speaker and preview for each eligible message.
It does not fetch missing history from the server. System messages remain subject
to Include system messages in settings. Text previews are inserted as plain text.

Checkbox refresh now also handles replaced content, removed checkboxes and changed
message IDs. Runtime checks for the checklist used a simulated DOM, not a live
SillyTavern/TauriTavern installation.
