import "./style.css";
import { API_URL, ADMIN_KEY } from "./config";
import { AVAILABLE_LISTS } from "@bulk-email-tool/shared";
import type { SendCampaignRequestBody, SendCampaignResponseBody } from "@bulk-email-tool/shared";

const form = document.querySelector<HTMLFormElement>("#campaign-form")!;
const listSelect = document.querySelector<HTMLSelectElement>("#list-select")!;
const subjectInput = document.querySelector<HTMLInputElement>("#subject")!;
const htmlInput = document.querySelector<HTMLTextAreaElement>("#html")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const submitBtn = form.querySelector<HTMLButtonElement>("button")!;

// "All subscribers" plus one option per named list.
listSelect.innerHTML = [
  `<option value="all">All subscribers</option>`,
  ...AVAILABLE_LISTS.map((list) => `<option value="${list}">${list}</option>`),
].join("");

function setStatus(message: string, kind: "success" | "error" | "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const confirmed = window.confirm(
    `Send "${subjectInput.value}" to "${listSelect.value}"? This can't be undone.`
  );
  if (!confirmed) return;

  submitBtn.disabled = true;
  setStatus("Queuing campaign...", "");

  const payload: SendCampaignRequestBody = {
    subject: subjectInput.value.trim(),
    html: htmlInput.value,
    listName: listSelect.value,
  };

  try {
    const res = await fetch(`${API_URL}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_KEY },
      body: JSON.stringify(payload),
    });
    const data: SendCampaignResponseBody = await res.json();

    if (res.ok && data.ok) {
      setStatus(`${data.message} Check CloudWatch logs on the send Lambda for results.`, "success");
      form.reset();
    } else {
      setStatus(data.message ?? "Something went wrong.", "error");
    }
  } catch {
    setStatus("Network error — please try again.", "error");
  } finally {
    submitBtn.disabled = false;
  }
});
