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
    includeSystem: false,
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
    let chat = getContext().chat ?? [];
    if (chat.length === 0 && window.chat && Array.isArray(window.chat)) {
        console.log("[Chat Copier] Using window.chat as fallback (length: " + window.chat.length + ")");
        chat = window.chat;
    }
    return chat;
}

// Apply the configured system-message filter to every selection method.
function isRealMessage(message) {
    if (!message) return false;

    // Must have text content
    if (!getSettings().includeSystem && message.is_system) return false;
    const text = String(message.mes || message.text || message.content || "");
    if (!text || text.trim() === "") return false;

    // Accept if it's a user, has a name, or a recognized role
    return !!(message.is_user || message.name || message.role === "user" || message.role === "assistant");
}

function cloneMessage(message) {
    return { ...message };
}

const selectedMessageIds = new Set();
// Keep object references: deletion cannot silently shift a selection to another message.
const selectedMessages = new Map();
let selectionChat = null;
let selectionKey = null;
function chatKey() {
    const c = getContext();
    return JSON.stringify([c.chatId ?? c.getCurrentChatId?.() ?? null, c.characterId, c.groupId]);
}
function reconcileSelection() {
    const chat = getChatMessages();
    const key = chatKey();
    if (selectionChat !== chat || selectionKey !== key) selectedMessages.clear();
    selectionChat = chat;
    selectionKey = key;
    selectedMessageIds.clear();
    for (const message of selectedMessages.keys()) {
        const index = chat.indexOf(message);
        if (index < 0 || !isRealMessage(message)) selectedMessages.delete(message);
        else selectedMessageIds.add(index);
    }
    $("#cc_count").text(`${selectedMessages.size} selected`);
}
function getSelectedMessages() {
    reconcileSelection();
    return getChatMessages().filter(m => selectedMessages.has(m)).map(cloneMessage);
}
function selectIndices(indices) {
    reconcileSelection();
    selectedMessages.clear();
    const chat = getChatMessages();
    for (const index of indices) if (isRealMessage(chat[index])) selectedMessages.set(chat[index], true);
    if (!selectMode) toggleSelectMode();
    reconcileSelection();
    injectCheckboxes();
}
function selectLastNMessages(n) {
    const chat = getChatMessages();
    const ids = chat.map((m, i) => isRealMessage(m) ? i : -1).filter(i => i >= 0);
    selectIndices(ids.slice(-n));
}

function syncCheckboxesFromSelection() {
    $("#chat .mes").each(function () {
        const messageId = Number($(this).attr("mesid"));
        $(this).find(".cc_mes_select").prop("checked", selectedMessageIds.has(messageId));
    });
}

function getLastNMessages(n) {
    const limit = Math.max(0, Number.parseInt(n, 10) || 0);
    return limit ? getAllMessages().slice(-limit) : [];
}

function getAllMessages() {
    return getChatMessages()
        .filter(isRealMessage)
        .map(cloneMessage);
}

// ── Formatting ────────────────────────────────────────────────────

// Use the host Markdown converter in an inert document; preserve block boundaries.
function plainText(raw) {
    const host = getContext().showdown;
    const converter = host?.makeHtml ? host : window.showdown?.Converter ? new window.showdown.Converter() : null;
    if (!converter?.makeHtml) return raw; // Lossless fallback if the host lacks a converter.
    const doc = new DOMParser().parseFromString(converter.makeHtml(raw), "text/html");
    doc.querySelectorAll("script,style").forEach(n => n.remove());
    doc.querySelectorAll("br").forEach(n => n.replaceWith("\n"));
    doc.querySelectorAll("img").forEach(n => n.replaceWith(n.getAttribute("alt") || ""));
    doc.querySelectorAll("p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6,tr").forEach(n => n.append("\n\n"));
    return doc.body.textContent.replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatMessage(message, settings) {
    const role = message.name || (message.is_user ? "User" : message.role || "Character");
    const raw = String(message.mes || message.text || message.content || "");
    const text = settings.copyFormat === "plain" ? plainText(raw) : raw;

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
    } finally {
        document.removeEventListener("copy", onCopy, { capture: true });
    }
}

async function copyToClipboard(text, count) {
    const clipboardText = String(text ?? "");

    if (!clipboardText) {
        toastr.warning("Nothing to copy.", "Chat Copier");
        return;
    }

    if (copyWithClipboardEvent(clipboardText)) {
        toastr.success(`Copied ${count} message(s) to clipboard!`, "Chat Copier");
        return;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(clipboardText);
            toastr.success(`Copied ${count} message(s) to clipboard!`, "Chat Copier");
            return;
        }
    } catch (error) {
        console.warn("[Chat Copier] Clipboard API failed.", error);
    }

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
        toastr.error("Clipboard access failed. Use Download selected instead.", "Chat Copier");
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
    anchor.download = getSettings().copyFormat === "markdown" ? filename.replace(/\.txt$/i, ".md") : filename;
    anchor.style.display = "none";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilenamePart(value, fallback = "chat") {
    const cleaned = String(value ?? "")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");

    return cleaned || fallback;
}

function getRandomFileToken(length = 6) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(length);

    if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
    }

    return Array.from({ length }, () =>
        alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
}

function getChatFilenamePrefix() {
    const ctx = getContext();
    const characterName =
        ctx?.name2 ||
        ctx?.character?.name ||
        ctx?.characters?.[ctx?.characterId]?.name ||
        "SillyTavern Chat";

    const now = new Date();
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");

    return `${sanitizeFilenamePart(characterName)} - ${date} - ${getRandomFileToken()}`;
}

function actionCopySelected() {
    const messages = getSelectedMessages();
    if (!messages.length) return toastr.warning("No messages selected.", "Chat Copier");
    return copyToClipboard(messagesToText(messages), messages.length);
}
function actionDownloadSelected() {
    const messages = getSelectedMessages();
    if (!messages.length) return toastr.warning("No messages selected.", "Chat Copier");
    downloadTextFile(messagesToText(messages), `${getChatFilenamePrefix()} - Selected ${messages.length}.txt`);
}

async function actionCopyLastN(n) {
    const messages = getLastNMessages(n);

    if (messages.length === 0) {
        toastr.warning("No messages to copy.", "Chat Copier");
        return;
    }

    await copyToClipboard(messagesToText(messages), messages.length);
}

function actionDownloadLastN(n) {
    const messages = getLastNMessages(n);

    if (messages.length === 0) {
        toastr.warning("No messages to export.", "Chat Copier");
        return;
    }

    downloadTextFile(
        messagesToText(messages),
        `${getChatFilenamePrefix()} - Last ${messages.length}.txt`,
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

    downloadTextFile(
        messagesToText(messages),
        `${getChatFilenamePrefix()} - Full Chat.txt`,
    );

    toastr.success(
        `Downloaded all ${messages.length} message(s) as TXT.`,
        "Chat Copier",
    );
}

// ── Selection mode ────────────────────────────────────────────────

let selectMode = false;

function injectCheckboxes() {
    reconcileSelection();
    if (!selectMode) return;

    $("#chat .mes").each(function () {
        const $message = $(this);


        const $header = $message
            .find(".mes_block, .mesHeader, .mes_text_wrapper, .mesTextWrapper")
            .first();

        const messageId = Number($message.attr("mesid"));
        if (!Number.isInteger(messageId) || !isRealMessage(getChatMessages()[messageId])) {
            $message.find(".cc_mes_select").remove();
            return;
        }
        if ($message.find(".cc_mes_select").length) return;
        const checked = selectedMessageIds.has(messageId) ? " checked" : "";
        const checkbox = `<input type="checkbox" class="cc_mes_select" title="Select this message"${checked} />`;
        $header.length ? $header.prepend(checkbox) : $message.prepend(checkbox);
    });

    syncCheckboxesFromSelection();
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
        selectedMessageIds.clear();
        selectedMessages.clear();
        reconcileSelection();
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
        <button type="button" id="cc_select_mode_btn" class="cc_qbtn" title="Toggle selection mode">
            <i class="fa fa-check-square"></i>
            <span class="cc_qbtn_label">Select: OFF</span>
        </button>
        <button type="button" id="cc_copy_selected" class="cc_qbtn" title="Copy selected messages to clipboard">
            <i class="fa fa-copy"></i>
            <span class="cc_qbtn_label">Copy selected</span>
        </button>
        <button type="button" id="cc_select_last50" class="cc_qbtn" title="Automatically select the last 50 messages">
            <i class="fa fa-list-check"></i>
            <span class="cc_qbtn_label">Select 50</span>
        </button>
        <button type="button" id="cc_select_last100" class="cc_qbtn" title="Automatically select the last 100 messages">
            <i class="fa fa-list-check"></i>
            <span class="cc_qbtn_label">Select 100</span>
        </button>
        <button type="button" id="cc_copy_last10" class="cc_qbtn" title="Copy last 10 messages from the bottom">
            <i class="fa fa-history"></i>
            <span class="cc_qbtn_label">10</span>
        </button>
        <button type="button" id="cc_copy_last30" class="cc_qbtn" title="Download last 30 messages as TXT">
            <i class="fa fa-download"></i>
            <span class="cc_qbtn_label">30 TXT</span>
        </button>
        <button type="button" id="cc_copy_all" class="cc_qbtn" title="Download entire chat as TXT">
            <i class="fa fa-file-download"></i>
            <span class="cc_qbtn_label">All TXT</span>
        </button>
        <button type="button" id="cc_download_selected" class="cc_qbtn">Download selected</button>
        <button type="button" id="cc_manual_list" class="cc_qbtn">Browse messages to tick</button>
        <span id="cc_count" aria-live="polite">0 selected</span>
        <label>From # <input id="cc_from" type="number" min="0" step="1" value="100" /></label>
        <label>To # <input id="cc_to" type="number" min="0" step="1" value="230" /></label>
        <button type="button" id="cc_range" class="cc_qbtn">Select range</button>
        <small>Use the # numbers shown on messages. Both endpoints are included.</small>
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
                    <label class="checkbox_label"><input type="checkbox" id="cc_include_system" ${settings.includeSystem ? "checked" : ""}/><span>Include system messages</span></label>
                    <label class="checkbox_label">
                        <span>Format:</span>
                        <select id="cc_format">
                            <option value="plain" ${settings.copyFormat === "plain" ? "selected" : ""}>Clean plain text</option>
                            <option value="markdown" ${settings.copyFormat === "markdown" ? "selected" : ""}>Original Markdown</option>
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
    observer = new MutationObserver(() => {
        if (!selectMode) return;
        window.clearTimeout(checkboxRefreshTimer);
        checkboxRefreshTimer = window.setTimeout(injectCheckboxes, 100);
    });
    observer.observe(chatElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["mesid"] });
}
let checkboxRefreshTimer = null;
let manualDialog = null;
function openManualList() {
    reconcileSelection();
    manualDialog?.remove();
    const dialog = document.createElement("dialog");
    manualDialog = dialog;
    dialog.id = "cc_manual_dialog";
    dialog.setAttribute("aria-label", "Select chat messages");
    const title = document.createElement("h3");
    title.textContent = "Tick messages to export";
    const hint = document.createElement("p");
    hint.textContent = "Includes older messages available in chat data. System-message filtering follows your settings.";
    const status = document.createElement("p");
    status.setAttribute("aria-live", "polite");
    const list = document.createElement("div");
    list.className = "cc_manual_rows";
    const chat = getChatMessages();
    const key = chatKey();
    const rows = document.createDocumentFragment();
    let eligible = 0;
    const refreshCount = () => { status.textContent = `${selectedMessages.size} selected · ${eligible} available`; };
    chat.forEach((message, index) => {
        if (!isRealMessage(message)) return;
        eligible++;
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedMessages.has(message);
        const preview = document.createElement("span");
        const name = message.name || (message.is_user ? "User" : "Character");
        preview.textContent = `#${index} ${name}: ${String(message.mes || message.text || message.content || "").slice(0, 240)}`;
        checkbox.addEventListener("change", () => {
            reconcileSelection();
            if (getChatMessages() !== chat || chatKey() !== key || !chat.includes(message)) {
                dialog.close();
                toastr.warning("The chat changed. Open the message list again.");
                return;
            }
            if (checkbox.checked) selectedMessages.set(message, true);
            else selectedMessages.delete(message);
            reconcileSelection();
            syncCheckboxesFromSelection();
            refreshCount();
        });
        label.append(checkbox, preview);
        rows.append(label);
    });
    list.append(rows);
    refreshCount();
    const actions = document.createElement("div");
    actions.className = "cc_manual_actions";
    for (const [text, action] of [["Copy selected", actionCopySelected], ["Download selected", actionDownloadSelected], ["Done", () => dialog.close()]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", action);
        actions.append(button);
    }
    dialog.append(title, hint, status, list, actions);
    dialog.addEventListener("close", () => { dialog.remove(); if (manualDialog === dialog) manualDialog = null; });
    document.body.append(dialog);
    dialog.showModal();

}

// ── Event binding ─────────────────────────────────────────────────

function bindEvents() {
    $(document).off(".chatCopier");

    $(document).on("click.chatCopier", "#cc_select_mode_btn", toggleSelectMode);
    $(document).on("click.chatCopier", "#cc_copy_selected", actionCopySelected);
    $(document).on("click.chatCopier", "#cc_manual_list", openManualList);
    $(document).on("click.chatCopier", "#cc_select_last50", () => selectLastNMessages(50));
    $(document).on("click.chatCopier", "#cc_select_last100", () => selectLastNMessages(100));
    $(document).on("change.chatCopier", ".cc_mes_select", function () {
        reconcileSelection();
        const messageId = Number($(this).closest(".mes").attr("mesid"));
        if (!Number.isInteger(messageId)) return;

        const message = getChatMessages()[messageId];
        if ($(this).prop("checked") && isRealMessage(message)) selectedMessages.set(message, true);
        else selectedMessages.delete(message);
        reconcileSelection();
    });
    $(document).on("click.chatCopier", "#cc_download_selected", actionDownloadSelected);
    $(document).on("click.chatCopier", "#cc_range", () => {
        const start = Number($("#cc_from").val()), end = Number($("#cc_to").val());
        const length = getChatMessages().length;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= length)
            return toastr.warning(`Use a range from 0 to ${Math.max(0, length - 1)}.`);
        selectIndices(Array.from({length: end - start + 1}, (_, i) => start + i));
    });
    $(document).on("change.chatCopier", "#cc_include_system", function () {
        updateSetting("includeSystem", $(this).prop("checked"));
        removeCheckboxes();
        injectCheckboxes();
    });
    $(document).on("click.chatCopier", "#cc_copy_last10", () => actionCopyLastN(10));
    $(document).on("click.chatCopier", "#cc_copy_last30", () => actionDownloadLastN(30));
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