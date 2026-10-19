import type { TGbc } from "../shared/bridge.js";
import { asLang, detectLang, type TLang } from "../shared/i18n.js";
import type { TDesktopReportDraft, TDesktopReportPreview, TDesktopSupportStatus } from "../shared/desktopSupport.js";
import { supportStrings } from "../shared/supportStrings.js";

/** The old window's support surface is independent of its capture renderer and reusable by the new app. */
export const mountDesktopSupport = (gbc: TGbc, language: () => TLang, closeSettings: () => void): (() => void) => {
  const anchor = document.getElementById("footer-credit");
  if (!anchor) return () => {};
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (text: string, action: () => void): HTMLButtonElement => {
    const node = element("button", text); node.type = "button"; node.className = "btn small"; node.addEventListener("click", action); return node;
  };
  const row = element("div"); row.className = "desktop-support-settings";
  const label = element("label");
  const toggle = element("input"); toggle.type = "checkbox"; toggle.disabled = true;
  const toggleText = element("span"); label.append(toggle, toggleText);
  const reportButton = button("", () => openReport());
  const statusLine = element("p"); statusLine.className = "settings-sub"; statusLine.setAttribute("role", "status");
  row.append(label, reportButton, statusLine); anchor.before(row);
  let status: TDesktopSupportStatus = { telemetryEnabled: false, consentChosen: true, available: false };
  let activeDialog: HTMLDialogElement | null = null;
  const close = (): void => { activeDialog?.close(); activeDialog?.remove(); activeDialog = null; document.getElementById("btn-settings")?.focus(); };
  const dialog = (title: string): HTMLDialogElement => {
    closeSettings();
    const node = element("dialog"); node.className = "desktop-support-dialog";
    const heading = element("h2", title); heading.id = "desktop-support-title"; node.setAttribute("aria-labelledby", heading.id);
    node.append(heading); document.body.append(node); activeDialog = node;
    node.addEventListener("cancel", () => { close(); });
    return node;
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
    const s = supportStrings(lang); const node = dialog(s.consentTitle);
    node.append(element("p", s.consentBody));
    const actions = element("div"); actions.className = "desktop-support-actions";
    const accept = button(s.accept, () => { accept.disabled = decline.disabled = true; void choose(true).then((ok) => { if (ok) close(); else { accept.disabled = decline.disabled = false; error.textContent = s.settingsError; } }); });
    const decline = button(s.decline, () => { accept.disabled = decline.disabled = true; void choose(false).then((ok) => { if (ok) close(); else { accept.disabled = decline.disabled = false; error.textContent = s.settingsError; } }); });
    const error = element("p"); error.setAttribute("role", "status");
    actions.append(decline, accept); node.append(button(s.privacy, () => { void gbc.openPrivacy(); }), error, actions); node.showModal(); decline.focus();
  };

  const openReport = (): void => {
    const s = supportStrings(language()); const node = dialog(s.report);
    if (!status.available || !gbc.desktopReportPreview || !gbc.desktopReportSubmit) {
      node.append(element("p", s.unavailable), button(s.cancel, close)); node.showModal(); return;
    }
    node.append(element("p", s.reportIntro));
    const form = element("form"); form.className = "desktop-report-form";
    const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string, input: T): T => {
      const wrapper = element("label"); wrapper.append(element("span", name), input); form.append(wrapper); return input;
    };
    const category = element("select");
    for (const key of ["capture", "upload", "update", "pairing", "other"] as const) { const option = element("option", s[key]); option.value = key; category.append(option); }
    field(s.category, category);
    const summary = field(s.summary, element("input")); summary.maxLength = 160; summary.required = true;
    const description = field(s.description, element("textarea")); description.maxLength = 8000; description.rows = 3; description.required = true;
    const expected = field(s.expected, element("textarea")); expected.maxLength = 2000; expected.rows = 2;
    const contact = field(s.contact, element("input")); contact.maxLength = 160;
    const include = element("input"); include.type = "checkbox"; include.checked = true;
    const includeLabel = element("label"); includeLabel.className = "desktop-support-check"; includeLabel.append(include, element("span", s.diagnostics)); form.append(includeLabel, element("p", s.diagnosticBody));
    const review = element("button", s.review); review.type = "submit"; review.className = "btn small";
    const editActions = element("div"); editActions.className = "desktop-support-actions"; editActions.append(button(s.cancel, close), review); form.append(editActions);
    const result = element("p"); result.setAttribute("role", "status");
    const previewArea = element("section"); previewArea.hidden = true;
    let preview: TDesktopReportPreview | null = null;
    let sending = false;
    const showPreview = (value: TDesktopReportPreview): void => {
      preview = value; previewArea.replaceChildren(element("h3", s.preview));
      for (const [title, text] of [[s.summary, value.payload.summary], [s.description, value.payload.description], [s.expected, value.payload.expected], [s.contact, value.payload.contact ?? ""]]) {
        if (text) { previewArea.append(element("strong", title), element("p", text)); }
      }
      if (value.payload.diagnostics) {
        const details = element("details"); details.append(element("summary", s.diagnostics), element("pre", JSON.stringify(value.payload.diagnostics, null, 2))); previewArea.append(details);
      }
      previewArea.append(element("p", s.identityNote));
      const actions = element("div"); actions.className = "desktop-support-actions";
      const back = button(s.back, () => { if (sending) return; form.hidden = false; previewArea.hidden = true; result.textContent = ""; summary.focus(); });
      const send = button(s.send, () => {
        if (sending || !preview) return;
        sending = true; send.disabled = back.disabled = true; send.textContent = s.sending; result.textContent = "";
        void gbc.desktopReportSubmit!(preview.reportId).then((reply) => {
          if (reply.ok) { result.textContent = `${s.success} #${reply.reportNumber}`; actions.replaceChildren(button(s.cancel, close)); }
          else { result.textContent = reply.reason === "rate-limited" ? s.rateLimited : reply.reason === "unavailable" ? s.unavailable : s.error; send.disabled = back.disabled = false; send.textContent = s.send; }
        }).catch(() => { result.textContent = s.error; send.disabled = back.disabled = false; send.textContent = s.send; }).finally(() => { sending = false; });
      });
      actions.append(back, send); previewArea.append(actions); form.hidden = true; previewArea.hidden = false; send.focus();
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault(); review.disabled = true; result.textContent = "";
      const draft: TDesktopReportDraft = { category: category.value as TDesktopReportDraft["category"], summary: summary.value, description: description.value, expected: expected.value, contact: contact.value, includeDiagnostics: include.checked };
      void gbc.desktopReportPreview!(draft).then((value) => { if (value) showPreview(value); else result.textContent = s.invalid; }).catch(() => { result.textContent = s.error; }).finally(() => { review.disabled = false; });
    });
    node.append(form, previewArea, result); node.showModal(); summary.focus();
  };
  const refresh = (): void => { const s = supportStrings(language()); toggleText.textContent = s.analytics; reportButton.textContent = s.report; };
  refresh();
  void gbc.desktopSupportGet?.().then(async (next) => {
    applyStatus(next);
    if (next.available && !next.consentChosen) {
      // Consent can arrive before the renderer's separate settings request resolves.
      const settings = await gbc.getSettings();
      if (!activeDialog) openConsent(asLang(settings.language) ?? detectLang(navigator.language));
    }
  }).catch(() => {});
  return refresh;
};
