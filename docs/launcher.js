// Launcher: installs butter-col through ButterController, lets the visitor
// pick a transport, then opens the typed URL through the proxy.
import { ButterController } from "/butter/controller.mjs";

const form = document.getElementById("omnibox");
const input = document.getElementById("target");
const button = form.querySelector("button");
const status = document.getElementById("status");
const picker = document.getElementById("transport");

const setStatus = (text, kind = "info") => {
  status.textContent = text;
  status.dataset.kind = kind;
};

const butter = new ButterController();
const ready = butter.init().then(async () => {
  const { active, available } = await butter.getTransport();
  for (const t of available) {
    const option = new Option(t.loaded ? t.name : `${t.name} (failed to load)`, t.name, false, t.name === active.name);
    option.disabled = !t.loaded;
    picker.add(option);
  }
  picker.disabled = available.length < 2;
}).catch((err) => {
  setStatus(String((err && err.message) || err), "error");
  throw err;
});

picker.addEventListener("change", async () => {
  try {
    const active = await butter.setTransport(picker.value);
    setStatus(`Using the "${active.name}" transport.`);
  } catch (err) {
    setStatus(String((err && err.message) || err), "error");
    const { active } = await butter.getTransport().catch(() => ({ active: null }));
    if (active) picker.value = active.name;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!input.value.trim()) return input.focus();
  button.disabled = true;
  setStatus("Warming up the butter…");
  try {
    await ready;
    butter.go(input.value);
  } catch (err) {
    setStatus(String((err && err.message) || err), "error");
    button.disabled = false;
  }
});
