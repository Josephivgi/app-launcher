import { esc, toast, errorText } from "./util.js";

let view = null; // { main, ctx }

const STATE = {
  connected: { label: "Connected", cls: "ready" },
  outdated: { label: "Points elsewhere", cls: "update" },
  missing: { label: "Not connected", cls: "" },
  unreadable: { label: "Settings file unreadable", cls: "error" },
};

function agentRow(a) {
  if (!a.installed) {
    return (
      '<div class="agent-row muted"><div><h3>' + esc(a.name) + ' <span class="status">Not installed</span></h3>' +
      '<p class="small">Install ' + esc(a.name) + " on this computer and App Launcher connects it here.</p></div></div>"
    );
  }
  const st = STATE[a.status] || STATE.missing;
  const connected = a.status === "connected";
  const unreadable = a.status === "unreadable";
  const action = unreadable
    ? ""
    : connected
      ? '<button class="btn sm ghost danger" data-disconnect="' + esc(a.id) + '">Disconnect</button>'
      : '<button class="btn sm primary" data-connect="' + esc(a.id) + '">Connect</button>';
  return (
    '<div class="agent-row"><div class="agent-main"><h3>' + esc(a.name) + ' <span class="status ' + st.cls + '">' + esc(st.label) + "</span></h3>" +
    '<p class="small muted"><code>' + esc(a.configPath) + "</code></p></div>" + action + "</div>"
  );
}

// The text a person pastes into any MCP-capable agent so it connects App
// Launcher itself. It names the exact server to add, and how to check it.
function connectPrompt(server) {
  return [
    "Connect App Launcher to you as an MCP server, so you can add, check and launch apps on this computer.",
    "",
    "1. Add a stdio MCP server named \"app-launcher\" to your MCP settings. Keep your other servers.",
    "   Command: " + server.command,
    "   Arguments: " + server.args.join(" "),
    "   Environment variable: ELECTRON_RUN_AS_NODE=1",
    "   If you have an add command for MCP servers, use it. Otherwise edit your MCP config file.",
    "2. Reload or restart your MCP servers so it starts.",
    "3. Check it works: call the app_list tool. It returns the apps on this computer.",
    "4. Before you manage apps, read launcher_guide. Then use app_add, app_update, app_check, app_launch and app_remove. Check that a file exists before you give its path.",
  ].join("\n");
}

function paint() {
  const { main } = view;
  const local = view;
  return view.ctx.shell.agents.list().then((res) => {
    if (view !== local) return;
    main.querySelector("[data-agents]").innerHTML = res.agents.map(agentRow).join("");
    main.querySelector("[data-prompt]").textContent = connectPrompt(res.server);
  }).catch((error) => toast(errorText(error)));
}

// Copies text with a hidden field, which works inside the app's own page.
function copyText(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand("copy");
  field.remove();
  return ok;
}

// The settings window refreshes when App Launcher rewrites an agent's entry.
export function onAgentsChanged() {
  if (view) paint();
}

export function renderAgents(main, ctx) {
  main.innerHTML =
    '<div class="page"><div class="page-inner">' +
    '<div class="page-head"><h1>Agents</h1></div>' +
    '<p class="muted">App Launcher connects to your agents through their MCP settings, the same way <code>claude mcp add</code> does. Once connected, an agent can add, check and launch apps for you. The entry is kept current: if App Launcher moves or updates, it is rewritten the next time App Launcher starts. Agents you have not installed are not touched.</p>' +
    '<div class="panel"><div class="rows" data-agents><div class="empty">Looking for agents…</div></div></div>' +
    '<div class="panel"><div class="panel-head"><h2>Connect another agent</h2><button class="btn sm ghost" data-copy>Copy prompt</button></div>' +
    '<div class="pad"><p class="small muted">Any agent that supports MCP servers can connect. Paste this prompt into it and it sets up the connection itself.</p>' +
    '<pre class="cmd" data-prompt></pre></div></div>' +
    "</div></div>";
  view = { main, ctx };
  const local = view;
  main.addEventListener("click", async (event) => {
    if (view !== local) return;
    if (event.target.closest("[data-copy]")) {
      const prompt = main.querySelector("[data-prompt]").textContent;
      toast(copyText(prompt) ? "Prompt copied. Paste it into your agent." : "Could not copy. Select the text and copy it.");
      return;
    }
    const connect = event.target.closest("[data-connect]");
    const disconnect = event.target.closest("[data-disconnect]");
    if (!connect && !disconnect) return;
    const target = connect || disconnect;
    const id = target.dataset.connect || target.dataset.disconnect;
    target.disabled = true;
    try {
      if (connect) {
        const status = await ctx.shell.agents.connect(id);
        toast(status === "connected" ? "Connected. The agent can now use App Launcher." : "Settings saved, but the entry did not read back as connected.");
      } else {
        await ctx.shell.agents.disconnect(id);
        toast("Disconnected.");
      }
    } catch (error) {
      toast(errorText(error));
    } finally {
      target.disabled = false;
      paint();
    }
  });
  paint();
  return () => {
    if (view === local) view = null;
  };
}
