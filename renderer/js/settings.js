import { toast, errorText } from "./util.js";

export const OTHER_APPS_URL = "https://jsystems.app";

export function renderSettings(main, ctx) {
  main.innerHTML =
    '<div class="page"><div class="page-inner">' +
    '<div class="page-head"><h1>Settings</h1></div>' +
    '<div class="panel"><div class="panel-head"><h2>Find other apps</h2></div>' +
    '<div class="pad settings-row"><p class="small muted">More apps from JSystems are listed on jsystems.app. The link opens in your browser.</p>' +
    '<button class="btn sm secondary" data-other-apps>Open jsystems.app</button></div></div>' +
    "</div></div>";
  const onClick = async (event) => {
    const btn = event.target.closest("[data-other-apps]");
    if (!btn) return;
    try {
      await ctx.shell.openExternal(OTHER_APPS_URL);
    } catch (error) {
      toast(errorText(error));
    }
  };
  main.addEventListener("click", onClick);
  return () => main.removeEventListener("click", onClick);
}
