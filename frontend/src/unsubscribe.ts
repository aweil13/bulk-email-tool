import "./style.css";
import { API_URL } from "./config";
import type { UnsubscribeResponseBody } from "@bulk-email-tool/shared";

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

function setStatus(message: string, kind: "success" | "error" | "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

async function run() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email");
  const token = params.get("token");

  if (!email || !token) {
    setStatus("This unsubscribe link is missing information.", "error");
    return;
  }

  try {
    const res = await fetch(
      `${API_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
    );
    const data: UnsubscribeResponseBody = await res.json();
    setStatus(data.message, res.ok && data.ok ? "success" : "error");
  } catch {
    setStatus("Network error — please try again.", "error");
  }
}

run();
