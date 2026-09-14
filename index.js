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

const selected = new Set();
let activeChat = null;
let activeKey = null;
let selectMode = false;
let observer = null;
let refreshTimer = null;
let manualDialog = null;

function settings() {
    return extension_settings[MODULE_NAME];
}

function loadSettings() {
    extension_settings[MODULE_NAME] = {
        ...DEFAULT_SETTINGS,
        ...extension_settings[MODULE_NAME],
    };
}

function chatMessages() {
    const chat = getContext().chat;
    return Array.isArray(chat) ? chat : [];
}

function chatKey() {
    const ctx = getContext();
    return JSON.stringify([
        ctx.chatId ?? ctx.getCurrentChatId?.() ?? null,
        ctx.characterId,
        ctx.groupId,
    ]);
}

function messageText(message) {
    return String(
        message?.mes ?? message?.text ?? message?.content ?? "",
    );
}

function eligible(message) {
    if (!message || !messageText(message).trim()) return false;
    if (message.is_system && !settings().includeSystem) return false;
    return Boolean(
        message.name ||
        message.is_user ||
        message.is_system ||
        message.role === "user" ||
        message.role === "assistant",
    );
}

function speaker(message) {
    return message.name ||
        (message.is_user ? "User" : message.role || "Character");
}

function reconcile() {
    const chat = chatMessages();
    const key = chatKey();

    if (chat !== activeChat || key !== activeKey) selected.clear();

    activeChat = chat;
    activeKey = key;

    const available = new Set(chat);
    for (const message of selected) {
        if (!available.has(message) || !eligible(message)) {
            selected.delete(message);
        }
    }

    $("#cc_count").text(`${selected.size} selected`);
}

function selectedMessages() {
    reconcile();
    return chatMessages().filter(message => selected.has(message));
}

function allMessages() {
    return chatMessages().filter(eligible);
}

function lastMessages(count) {
    return allMessages().slice(-count);
}

function plainText(raw) {
    const host = getContext().showdown;
    const converter = host?.makeHtml
        ? host
        : window.showdown?.Converter
            ? new window.showdown.Converter()
            : null;

    // Preserve content if the host does not expose a Markdown converter.
    if (!converter) return raw;

    const doc = new DOMParser().parseFromString(
        converter.makeHtml(raw),
        "text/html",
    );

    doc.querySelectorAll("script,style").forEach(node => node.remove());
    doc.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    doc.querySelectorAll("img").forEach(node => {
        node.replaceWith(node.getAttribute("alt") || "");
    });
    doc.querySelectorAll(
        "p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6,tr",
    ).forEach(node => node.append("\n\n"));

    return doc.body.textContent
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function exportText(messages) {
    const opts = settings();

    return messages.map(message => {
        const raw = messageText(message);
        const text = opts.copyFormat === "plain" ? plainText(raw) : raw;
        let result = text;

        if (opts.includeNames) {
            result = opts.copyFormat === "markdown"
                ? `**${speaker(message)}**: ${text}`
                : `${speaker(message)}: ${text}`;
        }

        if (opts.includeTimestamps && message.send_date) {
            result = `[${message.send_date}] ${result}`;
        }

        return result;
    }).join("\n\n");
}

function clipboardEventCopy(text) {
    let handled = false;

    const onCopy = event => {
        if (!event.clipboardData) return;
        event.clipboardData.setData("text/plain", text);
        event.preventDefault();
        handled = true;
    };

    document.addEventListener("copy", onCopy, true);
    try {
        return document.execCommand("copy") && handled;
    } catch {
        return false;
    } finally {
        document.removeEventListener("copy", onCopy, true);
    }
}

async function copyMessages(messages) {
    if (!messages.length) {
        toastr.warning("No messages selected.", "Chat Copier");
        return;
    }

    const text = exportText(messages);
    let copied = false;

    try {
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch {
        // Continue with local clipboard fallbacks.
    }

    if (!copied) copied = clipboardEventCopy(text);

    if (!copied) {
        const previousFocus = document.activeElement;
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.readOnly = true;
        textarea.style.cssText =
            "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;";

        const parent = manualDialog?.open ? manualDialog : document.body;
        parent.append(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);

        try {
            copied = document.execCommand("copy");
        } catch {
            copied = false;
        } finally {
            textarea.remove();
            previousFocus?.focus?.({ preventScroll: true });
        }
    }

    if (copied) {
        toastr.success(`Copied ${messages.length} message(s).`, "Chat Copier");
    } else {
        toastr.error(
            "Clipboard access failed. Use Download selected.",
            "Chat Copier",
        );
    }
}

function safeFilename(value) {
    return String(value)
        .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "")
        .slice(0, 100) || "Chat";
}

function downloadMessages(messages, label) {
    if (!messages.length) {
        toastr.warning("No messages to export.", "Chat Copier");
        return;
    }

    const ctx = getContext();
    const name = ctx.name2 ||
        ctx.characters?.[ctx.characterId]?.name ||
        "SillyTavern Chat";
    const now = new Date();
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const token = Math.random().toString(36).slice(2, 8);
    const markdown = settings().copyFormat === "markdown";
    const extension = markdown ? "md" : "txt";
    const blob = new Blob([exportText(messages)], {
        type: markdown
            ? "text/markdown;charset=utf-8"
            : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download =
        `${safeFilename(name)} - ${date} - ${token} - ${label}.${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function syncCheckboxes() {
    $("#chat .mes").each(function () {
        const rawId = this.getAttribute("mesid");
        const id = rawId === null ? NaN : Number(rawId);
        $(this).find(".cc_mes_select")
            .prop("checked", selected.has(chatMessages()[id]));
    });
}

function refreshCheckboxes() {
    reconcile();
    if (!selectMode) return;

    const chat = chatMessages();

    $("#chat .mes").each(function () {
        const rawId = this.getAttribute("mesid");
        const id = rawId === null ? NaN : Number(rawId);
        const row = $(this);

        if (!Number.isInteger(id) || !eligible(chat[id])) {
            row.find(".cc_mes_select").remove();
            return;
        }

        if (!row.find(".cc_mes_select").length) {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "cc_mes_select";
            checkbox.title = `Select message #${id}`;
            checkbox.setAttribute("aria-label", `Select message #${id}`);

            const container = row.find(
                ".mes_block, .mesHeader, .mes_text_wrapper, .mesTextWrapper",
            ).first();

            if (container.length) container.prepend(checkbox);
            else row.prepend(checkbox);
        }
    });

    syncCheckboxes();
}

function setSelectMode(enabled) {
    selectMode = enabled;
    $("#cc_select_mode_btn").toggleClass("cc_active", enabled);
    $("#cc_select_mode_btn .cc_qbtn_label")
        .text(enabled ? "Select: ON" : "Select: OFF");

    if (enabled) {
        refreshCheckboxes();
    } else {
        selected.clear();
        $(".cc_mes_select").remove();
        reconcile();
    }
}

function selectMessages(messages) {
    reconcile();
    selected.clear();
    messages.forEach(message => {
        if (eligible(message)) selected.add(message);
    });
    setSelectMode(true);
}

function selectRange() {
    const fromText = String($("#cc_from").val()).trim();
    const toText = String($("#cc_to").val()).trim();
    const from = Number(fromText);
    const to = Number(toText);
    const chat = chatMessages();

    if (
        !fromText ||
        !toText ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 0 ||
        to < from ||
        to >= chat.length
    ) {
        toastr.warning(
            chat.length
                ? `Enter message numbers from 0 to ${chat.length - 1}.`
                : "No chat messages are available.",
            "Chat Copier",
        );
        return;
    }

    selectMessages(chat.slice(from, to + 1));
    toastr.success(
        `Selected ${selected.size} message(s) from #${from} to #${to}.`,
        "Chat Copier",
    );
}

function openManualList() {
    reconcile();
    manualDialog?.remove();

    const chat = chatMessages();
    const key = chatKey();
    const dialog = document.createElement("dialog");
    manualDialog = dialog;
    dialog.id = "cc_manual_dialog";
    dialog.setAttribute("aria-label", "Select chat messages");

    const heading = document.createElement("h3");
    heading.textContent = "Tick messages to export";

    const hint = document.createElement("p");
    hint.textContent =
        "Older messages are included when available in chat data. " +
        "System-message filtering follows your settings.";

    const status = document.createElement("p");
    status.setAttribute("aria-live", "polite");

    const list = document.createElement("div");
    list.className = "cc_manual_rows";

    let count = 0;
    const refreshCount = () => {
        status.textContent =
            `${selected.size} selected · ${count} available`;
    };

    const stillCurrent = () => {
        reconcile();
        if (chatMessages() === chat && chatKey() === key) return true;

        dialog.close();
        toastr.warning(
            "The chat changed. Open the message list again.",
            "Chat Copier",
        );
        return false;
    };

    const fragment = document.createDocumentFragment();

    chat.forEach((message, index) => {
        if (!eligible(message)) return;
        count++;

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(message);

        const preview = document.createElement("span");
        preview.textContent =
            `#${index} ${speaker(message)}: ` +
            messageText(message).slice(0, 240);

        checkbox.addEventListener("change", () => {
            if (!stillCurrent()) return;

            if (!chat.includes(message)) {
                dialog.close();
                toastr.warning("Messages changed. Open the list again.");
                return;
            }

            if (checkbox.checked) selected.add(message);
            else selected.delete(message);

            reconcile();
            syncCheckboxes();
            refreshCount();
        });

        label.append(checkbox, preview);
        fragment.append(label);
    });

    list.append(fragment);
    refreshCount();

    const actions = document.createElement("div");
    actions.className = "cc_manual_actions";

    const controls = [
        ["Copy selected", () => {
            if (stillCurrent()) copyMessages(selectedMessages());
        }],
        ["Download selected", () => {
            if (!stillCurrent()) return;
            const messages = selectedMessages();
            downloadMessages(messages, `Selected ${messages.length}`);
        }],
        ["Done", () => dialog.close()],
    ];

    for (const [label, action] of controls) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", action);
        actions.append(button);
    }

    dialog.append(heading, hint, status, list, actions);
    dialog.addEventListener("close", () => {
        dialog.remove();
        if (manualDialog === dialog) manualDialog = null;
    });

    document.body.append(dialog);
    dialog.showModal();
}

function buildMenu() {
    if ($("#cc_quick_menu").length) return;

    $("#extensionsMenu").append(`
        <div id="cc_quick_menu" class="cc_quick_menu">
            <button type="button" id="cc_select_mode_btn" class="cc_qbtn">
                <span class="cc_qbtn_label">Select: OFF</span>
            </button>
            <button type="button" id="cc_copy_selected" class="cc_qbtn">
                Copy selected
            </button>
            <button type="button" id="cc_download_selected" class="cc_qbtn">
                Download selected
            </button>
            <button type="button" id="cc_select_last50" class="cc_qbtn">
                Select 50
            </button>
            <button type="button" id="cc_select_last100" class="cc_qbtn">
                Select 100
            </button>
            <button type="button" id="cc_copy_last10" class="cc_qbtn">
                Copy 10
            </button>
            <button type="button" id="cc_copy_last30" class="cc_qbtn">
                Download 30
            </button>
            <button type="button" id="cc_copy_all" class="cc_qbtn">
                Download all
            </button>
            <button type="button" id="cc_manual_list" class="cc_qbtn">
                Browse messages to tick
            </button>
            <span id="cc_count" aria-live="polite">0 selected</span>

            <div class="cc_range_fields"
                 style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <label>
                    From #
                    <input id="cc_from" type="number"
                           min="0" step="1" value="100">
                </label>
                <label>
                    To #
                    <input id="cc_to" type="number"
                           min="0" step="1" value="230">
                </label>
                <button type="button" id="cc_range" class="cc_qbtn">
                    Select range
                </button>
            </div>
            <small>
                Use the # numbers shown on messages.
                Both endpoints are included.
            </small>
        </div>
    `);
}

function buildSettings() {
    if ($("#chat_copier_settings").length) return;

    $("#extensions_settings").append(`
        <div id="chat_copier_settings" class="chat_copier_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Chat Copier Settings</b>
                    <div class="inline-drawer-icon
                                fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="cc_options">
                        <label class="checkbox_label">
                            <input type="checkbox" id="cc_include_names">
                            <span>Include names</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="cc_include_timestamps">
                            <span>Include timestamps</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="cc_include_system">
                            <span>Include system messages</span>
                        </label>
                        <label>
                            Format:
                            <select id="cc_format">
                                <option value="plain">Clean plain text</option>
                                <option value="markdown">Original Markdown</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `);

    $("#cc_include_names").prop("checked", settings().includeNames);
    $("#cc_include_timestamps").prop(
        "checked", settings().includeTimestamps,
    );
    $("#cc_include_system").prop("checked", settings().includeSystem);
    $("#cc_format").val(settings().copyFormat);
}

function bindEvents() {
    $(document).off(".chatCopier");

    // Bind directly: document-level handlers run too late to protect inputs.
    // Do not preventDefault: inputs must still receive focus and allow typing.
    $("#cc_quick_menu")
        .off(".chatCopier")
        .on(
            "pointerdown.chatCopier mousedown.chatCopier " +
            "click.chatCopier touchstart.chatCopier",
            "input, label",
            event => event.stopPropagation(),
        )
        .on("keydown.chatCopier keyup.chatCopier", "input", event => {
            event.stopPropagation();
            if (event.type === "keydown" && event.key === "Enter") {
                event.preventDefault();
                selectRange();
            }
        });

    // Menu actions are also bound locally, before stopping propagation.
    const actions = {
        cc_select_mode_btn: () => setSelectMode(!selectMode),
        cc_copy_selected: () => copyMessages(selectedMessages()),
        cc_download_selected: () => {
            const messages = selectedMessages();
            downloadMessages(messages, `Selected ${messages.length}`);
        },
        cc_select_last50: () => selectMessages(lastMessages(50)),
        cc_select_last100: () => selectMessages(lastMessages(100)),
        cc_copy_last10: () => copyMessages(lastMessages(10)),
        cc_copy_last30: () => {
            const messages = lastMessages(30);
            downloadMessages(messages, `Last ${messages.length}`);
        },
        cc_copy_all: () => downloadMessages(allMessages(), "Full Chat"),
        cc_manual_list: openManualList,
        cc_range: selectRange,
    };

    $("#cc_quick_menu").on(
        "click.chatCopier",
        "button",
        function (event) {
            event.preventDefault();
            event.stopPropagation();
            actions[this.id]?.();
        },
    );

    $(document).on(
        "change.chatCopier",
        ".cc_mes_select",
        function () {
            reconcile();
            const rawId = $(this).closest(".mes").attr("mesid");
            const id = rawId == null ? NaN : Number(rawId);
            const message = chatMessages()[id];

            if (!Number.isInteger(id) || !eligible(message)) return;
            if (this.checked) selected.add(message);
            else selected.delete(message);

            reconcile();
            syncCheckboxes();
        },
    );

    const checkboxSettings = {
        cc_include_names: "includeNames",
        cc_include_timestamps: "includeTimestamps",
        cc_include_system: "includeSystem",
    };

    for (const [id, key] of Object.entries(checkboxSettings)) {
        $(document).on("change.chatCopier", `#${id}`, function () {
            settings()[key] = this.checked;
            saveSettingsDebounced();

            if (key === "includeSystem") {
                $(".cc_mes_select").remove();
                refreshCheckboxes();
            }
        });
    }

    $(document).on("change.chatCopier", "#cc_format", function () {
        settings().copyFormat = this.value;
        saveSettingsDebounced();
    });
}

function setupObserver() {
    const chat = document.getElementById("chat");
    if (!chat) return;

    observer?.disconnect();
    observer = new MutationObserver(() => {
        if (!selectMode) return;
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refreshCheckboxes, 100);
    });

    observer.observe(chat, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["mesid"],
    });
}

jQuery(() => {
    loadSettings();

    let attempts = 0;
    const initialize = () => {
        if (
            !document.getElementById("extensionsMenu") ||
            !document.getElementById("extensions_settings") ||
            !document.getElementById("chat")
        ) {
            if (++attempts < 60) window.setTimeout(initialize, 500);
            return;
        }

        buildMenu();
        buildSettings();
        bindEvents();
        setupObserver();
    };

    initialize();
});