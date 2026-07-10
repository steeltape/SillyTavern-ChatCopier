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
    if (Object.keys(extension_settings[MODULE_NAME]).length === 0) {
        Object.assign(extension_settings[MODULE_NAME], DEFAULT_SETTINGS);
    }
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
    const ctx = getContext();
    return ctx.chat ?? [];
}

function getSelectedMessages() {
    const messages = getChatMessages();
    const result = [];

    $(".mes").each(function () {
        const $mes = $(this);
        const $cb = $mes.find(".cc_mes_select");
        
        if ($cb.length && $cb.prop("checked")) {
            // Read the 'mesid' attribute that SillyTavern assigns to each message
            const mesId = Number($mes.attr("mesid"));
            
            if (!isNaN(mesId) && mesId >= 0 && mesId < messages.length) {
                result.push(messages[mesId]);
            }
        }
    });

    return result;
}

function getLastNMessages(n) {
    const messages = getChatMessages();
    return messages.slice(-n);
}

// ── Formatting ────────────────────────────────────────────────────

function formatMessage(msg, settings) {
    const role = msg.is_user
        ? "User"
        : msg.name || "Character";
    const text = msg.mes ?? "";
    let line;

    if (settings.copyFormat === "markdown") {
        line = `**${role}**: ${text}`;
    } else {
        line = `${role}: ${text}`;
    }

    if (settings.includeTimestamps && msg.send_date) {
        line = `[${msg.send_date}] ${line}`;
    }

    if (!settings.includeNames) {
        line = text;
        if (settings.includeTimestamps && msg.send_date) {
            line = `[${msg.send_date}] ${line}`;
        }
    }

    return line;
}

function messagesToText(messages) {
    const settings = getSettings();
    return messages
        .map((msg) => formatMessage(msg, settings))
        .join("\n\n");
}

// ── Clipboard ─────────────────────────────────────────────────────

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        toastr.success("Copied to clipboard!", "Chat Copier");
    } catch (err) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            toastr.success("Copied to clipboard!", "Chat Copier");
        } catch (err2) {
            toastr.error("Failed to copy.", "Chat Copier");
        }
        document.body.removeChild(textarea);
    }
}

// ── Actions ────────────────────────────────────────────────────────

function actionCopySelected() {
    const selected = getSelectedMessages();
    if (selected.length === 0) {
        toastr.warning(
            "No messages selected. Toggle Select Mode and tick messages first.",
            "Chat Copier"
        );
        return;
    }
    copyToClipboard(messagesToText(selected));
}

function actionCopyLastN(n) {
    const messages = getLastNMessages(n);
    if (messages.length === 0) {
        toastr.warning("No messages to copy.", "Chat Copier");
        return;
    }
    copyToClipboard(messagesToText(messages));
}

function actionCopyAll() {
    const messages = getChatMessages();
    if (messages.length === 0) {
        toastr.warning("No messages to copy.", "Chat Copier");
        return;
    }
    copyToClipboard(messagesToText(messages));
}

// ── Selection mode: inject checkboxes ──────────────────────────────

let selectMode = false;

function injectCheckboxes() {
    if (!selectMode) return;

    $(".mes").each(function () {
        const $mes = $(this);
        if ($mes.find(".cc_mes_select").length === 0) {
            const $head = $mes.find(".mes_block, .mesHeader, .mes_text_wrapper, .mesTextWrapper").first();
            if ($head.length) {
                $head.prepend(
                    '<input type="checkbox" class="cc_mes_select" title="Select this message" />'
                );
            } else {
                $mes.prepend(
                    '<input type="checkbox" class="cc_mes_select" title="Select this message" />'
                );
            }
        }
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

// ── Build Quick Menu (Wizard Icon next to chatbox) ────────────────

function buildQuickMenu() {
    if ($("#cc_quick_menu").length > 0) return;

    const html = `
    <div id="cc_quick_menu" class="cc_quick_menu">
        <div id="cc_select_mode_btn" class="cc_qbtn" title="Toggle selection mode to add ticks to messages">
            <i class="fa fa-check-square"></i>
            <span class="cc_qbtn_label">Select: OFF</span>
        </div>
        <div id="cc_copy_selected" class="cc_qbtn" title="Copy selected messages">
            <i class="fa fa-copy"></i>
            <span class="cc_qbtn_label">Copy Tick</span>
        </div>
        <div id="cc_copy_last10" class="cc_qbtn" title="Copy last 10 messages">
            <i class="fa fa-history"></i>
            <span class="cc_qbtn_label">10</span>
        </div>
        <div id="cc_copy_last20" class="cc_qbtn" title="Copy last 20 messages">
            <i class="fa fa-clock"></i>
            <span class="cc_qbtn_label">20</span>
        </div>
        <div id="cc_copy_all" class="cc_qbtn" title="Copy entire chat">
            <i class="fa fa-file-export"></i>
            <span class="cc_qbtn_label">All</span>
        </div>
    </div>`;

    $("#extensionsMenu").append(html);
}

// ── Build Settings Panel (Puzzle Icon menu) ───────────────────────

function buildSettingsPanel() {
    if ($("#chat_copier_settings").length > 0) return;

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

// ── MutationObserver: detect new messages ─────────────────────────

let observer = null;

function setupObserver() {
    const chatEl = document.getElementById("chat");
    if (!chatEl) {
        setTimeout(setupObserver, 1000);
        return;
    }

    observer = new MutationObserver(function (mutations) {
        let newMessage = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (
                        node.nodeType === 1 &&
                        (node.classList?.contains("mes") ||
                            node.querySelector?.(".mes"))
                    ) {
                        newMessage = true;
                        break;
                    }
                }
            }
            if (newMessage) break;
        }

        if (newMessage && selectMode) {
            setTimeout(injectCheckboxes, 300);
        }
    });

    observer.observe(chatEl, { childList: true, subtree: true });
}

// ── Event binding ─────────────────────────────────────────────────

function bindEvents() {
    $(document).on("click", "#cc_select_mode_btn", toggleSelectMode);
    $(document).on("click", "#cc_copy_selected", actionCopySelected);
    $(document).on("click", "#cc_copy_last10", () => actionCopyLastN(10));
    $(document).on("click", "#cc_copy_last20", () => actionCopyLastN(20));
    $(document).on("click", "#cc_copy_all", actionCopyAll);

    $(document).on("change", "#cc_include_names", function () {
        updateSetting("includeNames", $(this).prop("checked"));
    });
    $(document).on("change", "#cc_include_timestamps", function () {
        updateSetting("includeTimestamps", $(this).prop("checked"));
    });
    $(document).on("change", "#cc_format", function () {
        updateSetting("copyFormat", $(this).val());
    });
}

// ── Init ──────────────────────────────────────────────────────────

jQuery(async () => {
    loadSettings();

    setTimeout(() => {
        buildQuickMenu();
        buildSettingsPanel();
        bindEvents();
        setupObserver();

        console.log("[Chat Copier] Extension loaded successfully.");
    }, 1500);
});