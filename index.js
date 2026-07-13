import {
    getContext,
    extension_settings,
} from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE_NAME = "chat_copier";

const DEFAULT_SETTINGS = {
    copyFormat: "plain",
    includeNames: true,
    includeTimestamps: false,
};

// ── Settings ─────────────────────────────────────────────────────

function loadSettings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    Object.assign(extension_settings[MODULE_NAME], {
        ...DEFAULT_SETTINGS,
        ...extension_settings[MODULE_NAME],
    });
}

function getSettings() {
    return extension_settings[MODULE_NAME] ?? DEFAULT_SETTINGS;
}

function updateSetting(key, value) {
    loadSettings();
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

// ── Message gathering ─────────────────────────────────────────────

function getChatMessages() {
    return getContext().chat ?? [];
}

function isRealMessage(message) {
    return Boolean(message) && !message.is_system;
}

function cloneMessage(message) {
    return { ...message };
}

function getSelectedMessages() {
    const messages = getChatMessages();
    const selected = [];

    $(".mes").each(function () {
        const $messageElement = $(this);
        const $checkbox = $messageElement.find(".cc_mes_select");

        if (!$checkbox.length || !$checkbox.prop("checked")) return;

        const messageId = Number($messageElement.attr("mesid"));
        if (!Number.isInteger(messageId) || messageId < 0 || messageId >= messages.length) return;

        const message = messages[messageId];
        if (isRealMessage(message)) selected.push(cloneMessage(message));
    });

    return selected;
}

function getRenderedMessageText(messageIndex) {
    const $messageElement = $(`.mes[mesid="${messageIndex}"]`).last();
    if (!$messageElement.length) return "";

    const $textElement = $messageElement.find(".mes_text").first();
    if (!$textElement.length) return "";

    return $textElement.text().trim();
}

// Returns the newest N non-system messages, counted from the bottom of the
// complete SillyTavern chat array, while preserving normal reading order.
function getLastNMessages(n) {
    const limit = Math.max(0, Number.parseInt(n, 10) || 0);
    if (limit === 0) return [];

    const chat = getChatMessages();
    const collected = [];

    for (let index = chat.length - 1; index >= 0 && collected.length < limit; index--) {
        const message = chat[index];
        if (!isRealMessage(message)) continue;

        collected.push({
            message: cloneMessage(message),
            chatIndex: index,
        });
    }

    collected.reverse();

    // During or immediately after generation, ctx.chat can lag a few words
    // behind the text already visible in the newest rendered message.
    const newest = collected[collected.length - 1];
    if (newest) {
        const renderedText = getRenderedMessageText(newest.chatIndex);
        const storedText = String(newest.message.mes ?? "").trim();

        if (renderedText && renderedText.length >= storedText.length) {
            newest.message.mes = renderedText;
        }
    }

    return collected.map((entry) => entry.message);
}

function getAllMessages() {
    return getChatMessages()
        .filter(isRealMessage)
        .map(cloneMessage);
}

// ── Formatting ────────────────────────────────────────────────────

function formatMessage(message, settings) {
    const role = message.is_user ? "User" : message.name || "Character";
    const text = String(message.mes ?? "");

    let formatted = settings.includeNames
        ? settings.copyFormat === "markdown"
            ? `**${role}**: ${text}`
            : `${role}: ${text}`
        : text;

    if (settings.includeTimestamps && message.send_date) {
        formatted = `[${message.send_date}] ${formatted}`;
    }

    return formatted;
}

function messagesToText(messages) {
    const settings = getSettings();
    return messages.map((message) => formatMessage(message, settings)).join("\n\n");
}

// ── Clipboard ─────────────────────────────────────────────────────

function copyWithClipboardEvent(text) {
    let handled = false;

    const onCopy = (event) => {
        try {
            event.preventDefault();
            event.clipboardData.clearData();
            event.clipboardData.setData("text/plain", text);
            handled = true;
        } catch (error) {
            console.error("[Chat Copier] Clipboard event failed.", error);
        }
    };

    document.addEventListener("copy", onCopy, { once: true, capture: true });

    try {
        const commandSucceeded = document.execCommand("copy");
        return commandSucceeded && handled;
    } catch (error) {
        console.warn("[Chat Copier] execCommand copy failed.", error);
        document.removeEventListener("copy", onCopy, { capture: true });
        return false;
    }
}

async function copyToClipboard(text, count) {
    const clipboardText = String(text ?? "");

    if (!clipboardText) {
        toastr.warning("Nothing to copy.", "Chat Copier");
        return;
    }

    // Use a synchronous ClipboardEvent first. On Android WebView this avoids
    // selection-length and delayed-write issues that can truncate the tail of
    // larger clipboard payloads.
    if (copyWithClipboardEvent(clipboardText)) {
        toastr.success(`Copied ${count} message(s) to clipboard!`, "Chat Copier");
        return;
    }

    // Standards-based fallback.
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(clipboardText);
            toastr.success(`Copied ${count} message(s) to clipboard!`, "Chat Copier");
            return;
        }
    } catch (error) {
        console.warn("[Chat Copier] Clipboard API failed.", error);
    }

    // Final fallback using a visible-size textarea and a synchronous selection.
    const textarea = document.createElement("textarea");
    textarea.value = clipboardText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "8px";
    textarea.style.top = "8px";
    textarea.style.width = "2px";
    textarea.style.height = "2px";
    textarea.style.opacity = "0.01";
    textarea.style.zIndex = "2147483647";

    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, clipboardText.length);

    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch (error) {
        console.error("[Chat Copier] Textarea fallback failed.", error);
    } finally {
        textarea.remove();
    }

    if (copied) {
        toastr.success(`Copied ${count} message(s) to clipboard!`, "Chat Copier");
    } else {
        toastr.error("Android blocked clipboard access.", "Chat Copier");
    }
}

// ── Actions ────────────────────────────────────────────────────────

function downloadTextFile(text, filename) {
    const blob = new Blob([String(text ?? "")], {
        type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function makeDownloadTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function actionCopySelected() {
    const selected = getSelectedMessages();

    if (selected.length === 0) {
        toastr.warning("No messages selected.", "Chat Copier");
        return;
    }

    await copyToClipboard(messagesToText(selected), selected.length);
}

async function actionCopyLastN(n) {
    const messages = getLastNMessages(n);

    if (messages.length === 0) {
        toastr.warning("No messages to copy.", "Chat Copier");
        return;
    }

    await copyToClipboard(messagesToText(messages), messages.length);
}

function actionDownloadLast20() {
    const messages = getLastNMessages(20);

    if (messages.length === 0) {
        toastr.warning("No messages to export.", "Chat Copier");
        return;
    }

    downloadTextFile(
        messagesToText(messages),
        `sillytavern-last-20-${makeDownloadTimestamp()}.txt`,
    );

    toastr.success(
        `Downloaded the last ${messages.length} message(s) as TXT.`,
        "Chat Copier",
    );
}

function actionDownloadAll() {
    const messages = getAllMessages();

    if (messages.length === 0) {
        toastr.warning("No messages to export.", "Chat Copier");
        return;
    }

    // Refresh the newest message from the rendered DOM so a just-finished
    // response is not missing its final words in the exported file.
    const newest = getLastNMessages(1)[0];
    if (newest) {
        messages[messages.length - 1] = newest;
    }

    downloadTextFile(
        messagesToText(messages),
        `sillytavern-complete-chat-${makeDownloadTimestamp()}.txt`,
    );

    toastr.success(
        `Downloaded all ${messages.length} message(s) as TXT.`,
        "Chat Copier",
    );
}

// ── Selection mode ────────────────────────────────────────────────

let selectMode = false;

function injectCheckboxes() {
    if (!selectMode) return;

    $(".mes").not(".system_message").each(function () {
        const $message = $(this);
        if ($message.find(".cc_mes_select").length) return;

        const $header = $message
            .find(".mes_block, .mesHeader, .mes_text_wrapper, .mesTextWrapper")
            .first();

        const checkbox = '<input type="checkbox" class="cc_mes_select" title="Select this message" />';
        $header.length ? $header.prepend(checkbox) : $message.prepend(checkbox);
    });
}

function removeCheckboxes() {
    $(".cc_mes_select").remove();
}

function toggleSelectMode() {
    selectMode = !selectMode;

    if (selectMode) {
        injectCheckboxes();
        $("#cc_select_mode_btn").addClass("cc_active");
        $("#cc_select_mode_btn .cc_qbtn_label").text("Select: ON");
    } else {
        removeCheckboxes();
        $("#cc_select_mode_btn").removeClass("cc_active");
        $("#cc_select_mode_btn .cc_qbtn_label").text("Select: OFF");
    }
}

// ── Quick menu ────────────────────────────────────────────────────

function buildQuickMenu() {
    if ($("#cc_quick_menu").length) return;

    const html = `
    <div id="cc_quick_menu" class="cc_quick_menu">
        <div id="cc_select_mode_btn" class="cc_qbtn" title="Toggle selection mode">
            <i class="fa fa-check-square"></i>
            <span class="cc_qbtn_label">Select: OFF</span>
        </div>
        <div id="cc_copy_selected" class="cc_qbtn" title="Copy ticked messages">
            <i class="fa fa-copy"></i>
            <span class="cc_qbtn_label">Copy Tick</span>
        </div>
        <div id="cc_copy_last10" class="cc_qbtn" title="Copy last 10 messages from the bottom">
            <i class="fa fa-history"></i>
            <span class="cc_qbtn_label">10</span>
        </div>
        <div id="cc_copy_last20" class="cc_qbtn" title="Download last 20 messages as TXT">
            <i class="fa fa-download"></i>
            <span class="cc_qbtn_label">20 TXT</span>
        </div>
        <div id="cc_copy_all" class="cc_qbtn" title="Download entire chat as TXT">
            <i class="fa fa-file-download"></i>
            <span class="cc_qbtn_label">All TXT</span>
        </div>
    </div>`;

    $("#extensionsMenu").append(html);
}

// ── Settings panel ────────────────────────────────────────────────

function buildSettingsPanel() {
    if ($("#chat_copier_settings").length) return;

    const settings = getSettings();
    const html = `
    <div id="chat_copier_settings" class="chat_copier_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>📋 Chat Copier Settings</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="cc_options">
                    <label class="checkbox_label">
                        <input type="checkbox" id="cc_include_names" ${settings.includeNames ? "checked" : ""}/>
                        <span>Include Names</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="cc_include_timestamps" ${settings.includeTimestamps ? "checked" : ""}/>
                        <span>Include Timestamps</span>
                    </label>
                    <label class="checkbox_label">
                        <span>Format:</span>
                        <select id="cc_format">
                            <option value="plain" ${settings.copyFormat === "plain" ? "selected" : ""}>Plain</option>
                            <option value="markdown" ${settings.copyFormat === "markdown" ? "selected" : ""}>Markdown</option>
                        </select>
                    </label>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings").append(html);
}

// ── Mutation observer ─────────────────────────────────────────────

let observer = null;

function setupObserver() {
    const chatElement = document.getElementById("chat");

    if (!chatElement) {
        window.setTimeout(setupObserver, 1000);
        return;
    }

    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
        if (!selectMode) return;

        const hasNewMessage = mutations.some((mutation) =>
            Array.from(mutation.addedNodes).some(
                (node) =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.classList?.contains("mes") || node.querySelector?.(".mes")),
            ),
        );

        if (hasNewMessage) window.setTimeout(injectCheckboxes, 300);
    });

    observer.observe(chatElement, { childList: true, subtree: true });
}

// ── Event binding ─────────────────────────────────────────────────

function bindEvents() {
    $(document).off(".chatCopier");

    $(document).on("click.chatCopier", "#cc_select_mode_btn", toggleSelectMode);
    $(document).on("click.chatCopier", "#cc_copy_selected", actionCopySelected);
    $(document).on("click.chatCopier", "#cc_copy_last10", () => actionCopyLastN(10));
    $(document).on("click.chatCopier", "#cc_copy_last20", actionDownloadLast20);
    $(document).on("click.chatCopier", "#cc_copy_all", actionDownloadAll);

    $(document).on("change.chatCopier", "#cc_include_names", function () {
        updateSetting("includeNames", $(this).prop("checked"));
    });

    $(document).on("change.chatCopier", "#cc_include_timestamps", function () {
        updateSetting("includeTimestamps", $(this).prop("checked"));
    });

    $(document).on("change.chatCopier", "#cc_format", function () {
        updateSetting("copyFormat", $(this).val());
    });
}

// ── Init ──────────────────────────────────────────────────────────

jQuery(() => {
    loadSettings();

    window.setTimeout(() => {
        buildQuickMenu();
        buildSettingsPanel();
        bindEvents();
        setupObserver();
        console.log("[Chat Copier] Extension loaded successfully.");
    }, 1500);
});
