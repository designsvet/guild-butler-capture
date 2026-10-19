import type { TGbc } from "../shared/bridge.js";
import { asLang, detectLang, type TLang } from "../shared/i18n.js";
import { PRIVACY_URL } from "../shared/ipc.js";
import type { TDesktopReportDraft, TDesktopReportPreview, TDesktopSupportStatus } from "../shared/desktopSupport.js";
import { supportStrings } from "../shared/supportStrings.js";

/** The classic support surface shares the main-process preview/submit contract with the new app. */
export const mountDesktopSupport = (gbc: TGbc, language: () => TLang, closeSettings: () => void): (() => void) => {
  const anchor = document.getElementById("footer-credit");
  if (!anchor) return () => {};
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (text: string, action: () => void, primary = false): HTMLButtonElement => {
    const node = element("button", text);
    node.type = "button"; node.className = `gbtn ${primary ? "gbtn-primary" : "gbtn-outline"}`;
    node.addEventListener("click", action); return node;
  };
  const focusHeading = (heading: HTMLElement): void => { heading.tabIndex = -1; heading.focus({ preventScroll: true }); };
  const row = element("div"); row.className = "desktop-support-settings";
  const label = element("label"); label.className = "gb-choice-label";
  const toggle = element("input"); toggle.type = "checkbox"; toggle.className = "gb-check"; toggle.disabled = true;
  const toggleText = element("span"); label.append(toggle, toggleText);
  const reportButton = button("", () => openReport(), true);
  const statusLine = element("p"); statusLine.className = "settings-sub"; statusLine.setAttribute("role", "status");
  row.append(label, reportButton, statusLine); anchor.before(row);
  let status: TDesktopSupportStatus = { telemetryEnabled: false, consentChosen: true, available: false };
  let activeDialog: HTMLDialogElement | null = null;
  const dialog = (title: string) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeSettings();
    const node = element("dialog"); node.className = "gb-dialog desktop-support-dialog";
    const heading = element("h2", title); heading.id = "desktop-support-title"; heading.tabIndex = -1;
    node.setAttribute("aria-labelledby", heading.id);
    const header = element("header"); header.className = "desktop-support-header"; header.append(heading);
    const body = element("div"); body.className = "desktop-support-body";
    const footer = element("footer"); footer.className = "desktop-support-footer";
    const result = element("p"); result.className = "desktop-support-result"; result.setAttribute("role", "status");
    const actions = element("div"); actions.className = "desktop-support-actions"; footer.append(result, actions);
    node.append(header, body, footer); document.body.append(node); activeDialog = node;
    let busy = false;
    const close = (): void => {
      if (busy) return;
      node.close(); node.remove();
      if (activeDialog === node) {
        activeDialog = null;
        const canRestore = opener?.isConnected && opener.tabIndex >= 0 && opener.getClientRects().length > 0
          && !opener.matches(":disabled, [aria-disabled=true]") && getComputedStyle(opener).visibility !== "hidden";
        (canRestore ? opener : document.getElementById("btn-settings"))?.focus({ preventScroll: true });
      }
    };
    node.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    const show = (): void => { node.showModal(); body.scrollTop = 0; focusHeading(heading); };
    return { node, heading, body, actions, result, close, show, setBusy: (value: boolean): void => { busy = value; } };
  };
  const applyStatus = (next: TDesktopSupportStatus): void => { status = next; toggle.checked = next.telemetryEnabled; toggle.disabled = !next.available; };
  const choose = async (enabled: boolean): Promise<boolean> => {
    toggle.disabled = true; statusLine.textContent = "";
    try {
      const next = await gbc.desktopSupportConsent?.(enabled);
      if (!next) throw new Error("unavailable");
      applyStatus(next); return true;
    } catch { statusLine.textContent = supportStrings(language()).settingsError; applyStatus(status); return false; }
  };
  toggle.addEventListener("change", () => { void choose(toggle.checked); });

  const openConsent = (lang: TLang): void => {
    const s = supportStrings(lang); const d = dialog(s.consentTitle);
    d.node.classList.add("desktop-support-consent");
    const privacy = element("a", s.privacy); privacy.href = PRIVACY_URL; privacy.className = "desktop-support-privacy";
    privacy.addEventListener("click", (event) => { event.preventDefault(); void gbc.openPrivacy(); });
    privacy.addEventListener("auxclick", (event) => { event.preventDefault(); if (event.button === 1) void gbc.openPrivacy(); });
    d.body.append(element("p", s.consentBody), privacy);
    const decide = (enabled: boolean): void => {
      accept.disabled = decline.disabled = true; d.setBusy(true);
      void choose(enabled).then((ok) => {
        d.setBusy(false);
        if (ok) d.close(); else { accept.disabled = decline.disabled = false; d.result.textContent = s.settingsError; }
      });
    };
    const accept = button(s.accept, () => decide(true), true);
    const decline = button(s.decline, () => decide(false));
    d.actions.append(decline, accept); d.show();
  };

  const openReport = (): void => {
    const s = supportStrings(language()); const d = dialog(s.report);
    if (!status.available || !gbc.desktopReportPreview || !gbc.desktopReportSubmit) {
      d.body.append(element("p", s.unavailable)); d.actions.append(button(s.cancel, d.close)); d.show(); return;
    }
    const intro = element("p", s.reportIntro); intro.className = "desktop-support-intro";
    const form = element("form"); form.className = "desktop-report-form"; form.id = "desktop-report-form";
    const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string, input: T, wide = false): T => {
      const wrapper = element("label"); wrapper.className = `desktop-report-field${wide ? " desktop-report-wide" : ""}`;
      input.className = "gb-well desktop-report-input";
      wrapper.append(element("span", name), input); form.append(wrapper); return input;
    };
    const category = element("select");
    for (const key of ["capture", "upload", "update", "pairing", "other"] as const) { const option = element("option", s[key]); option.value = key; category.append(option); }
    field(s.category, category);
    const summary = field(s.summary, element("input")); summary.maxLength = 160; summary.required = true;
    const description = field(s.description, element("textarea"), true); description.maxLength = 8000; description.rows = 3; description.required = true;
    const expected = field(s.expected, element("textarea")); expected.maxLength = 2000; expected.rows = 2;
    const contact = field(s.contact, element("input")); contact.maxLength = 160;
    const include = element("input"); include.type = "checkbox"; include.className = "gb-check"; include.checked = true;
    const diagnostics = element("div"); diagnostics.className = "desktop-report-wide desktop-report-diagnostics";
    const includeLabel = element("label"); includeLabel.className = "gb-choice-label"; includeLabel.append(include, element("span", s.diagnostics));
    const diagnosticBody = element("p", s.diagnosticBody); diagnosticBody.id = "desktop-report-diagnostics"; include.setAttribute("aria-describedby", diagnosticBody.id);
    diagnostics.append(includeLabel, diagnosticBody); form.append(diagnostics);
    const review = button(s.review, () => {}, true); review.type = "submit"; review.setAttribute("form", form.id);
    const editActions = (): void => { d.actions.replaceChildren(button(s.cancel, d.close), review); };
    editActions();
    const previewArea = element("section"); previewArea.className = "desktop-report-preview"; previewArea.hidden = true;
    let preview: TDesktopReportPreview | null = null;
    let sending = false;
    const showPreview = (value: TDesktopReportPreview): void => {
      if (!d.node.isConnected) return;
      preview = value;
      const heading = element("h3", s.preview); heading.tabIndex = -1; previewArea.replaceChildren(heading);
      const entries = element("dl");
      for (const [title, text] of [[s.category, s[value.payload.category]], [s.summary, value.payload.summary], [s.description, value.payload.description], [s.expected, value.payload.expected], [s.contact, value.payload.contact ?? ""]]) {
        if (text) entries.append(element("dt", title), element("dd", text));
      }
      previewArea.append(entries);
      if (value.payload.diagnostics) {
        const details = element("details"); details.append(element("summary", s.diagnostics), element("pre", JSON.stringify(value.payload.diagnostics, null, 2))); previewArea.append(details);
      }
      previewArea.append(element("p", s.identityNote));
      const back = button(s.back, () => {
        if (sending) return;
        form.hidden = false; intro.hidden = false; previewArea.hidden = true; d.result.textContent = ""; editActions(); d.body.scrollTop = 0; focusHeading(d.heading);
      });
      const send = button(s.send, () => {
        if (sending || !preview) return;
        sending = true; d.setBusy(true); send.disabled = back.disabled = true; send.textContent = s.sending; d.result.textContent = "";
        void gbc.desktopReportSubmit!(preview.reportId).then((reply) => {
          if (reply.ok) { d.result.textContent = `${s.success} #${reply.reportNumber}`; d.actions.replaceChildren(button(s.close, d.close)); }
          else { d.result.textContent = reply.reason === "rate-limited" ? s.rateLimited : reply.reason === "unavailable" ? s.unavailable : s.error; send.disabled = back.disabled = false; send.textContent = s.send; }
        }).catch(() => { d.result.textContent = s.error; send.disabled = back.disabled = false; send.textContent = s.send; }).finally(() => { sending = false; d.setBusy(false); });
      }, true);
      d.actions.replaceChildren(back, send); form.hidden = true; intro.hidden = true; previewArea.hidden = false; d.body.scrollTop = 0; focusHeading(heading);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault(); if (review.disabled) return; review.disabled = true; d.result.textContent = "";
      const draft: TDesktopReportDraft = { category: category.value as TDesktopReportDraft["category"], summary: summary.value, description: description.value, expected: expected.value, contact: contact.value, includeDiagnostics: include.checked };
      void gbc.desktopReportPreview!(draft).then((value) => { if (value) showPreview(value); else d.result.textContent = s.invalid; }).catch(() => { d.result.textContent = s.error; }).finally(() => { review.disabled = false; });
    });
    d.body.append(intro, form, previewArea); d.show();
  };
  const refresh = (): void => { const s = supportStrings(language()); toggleText.textContent = s.analytics; reportButton.textContent = s.report; };
  refresh();
  void gbc.desktopSupportGet?.().then(async (next) => {
    applyStatus(next);
    if (next.available && !next.consentChosen) {
      const settings = await gbc.getSettings();
      if (!activeDialog) openConsent(asLang(settings.language) ?? detectLang(navigator.language));
    }
  }).catch(() => {});
  return refresh;
};
