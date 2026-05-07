const output = document.querySelector("#output");
const status = document.querySelector("#status");
const buttons = document.querySelectorAll("button[data-action]");
const wallets = document.querySelector("#wallets");
const mcpToolList = document.querySelector("#mcp-tool-list");
const mcpSelectedName = document.querySelector("#mcp-selected-name");
const mcpStatusLine = document.querySelector("#mcp-status-line");
const mcpResult = document.querySelector("#mcp-result");
const mcpReceipt = document.querySelector("#mcp-receipt");
const mcpFlow = document.querySelector("#mcp-flow");
const mcpPaymentMode = document.querySelector("#mcp-payment-mode");
const mcpSessionLine = document.querySelector("#mcp-session-line");
const mcpAccountInput = document.querySelector("#mcp-account-input");
const mcpLimitInput = document.querySelector("#mcp-limit-input");

let mcpTools = [];
let selectedMcpTool = "analyze_account_risk";
let channelSessionActive = false;

async function request(path, options) {
  const response = await fetch(path, options);
  const text = await response.text();
  let body = text;

  try {
    body = JSON.parse(text);
  } catch {
    // Keep non-JSON bodies readable in the output panel.
  }

  return {
    status: response.status,
    wwwAuthenticate: response.headers.get("www-authenticate"),
    paymentReceipt: response.headers.get("payment-receipt"),
    body,
  };
}

function write(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Resets the JSON output panel plus MCP workbench UI (browser-side only). Server MPP stores are unchanged — restart Node to clear replay/credential memory. */
function resetDemoWorkbenchAndOutput() {
  channelSessionActive = false;
  mcpPaymentMode.value = "charge";
  setMcpFlow(0);
  mcpStatusLine.textContent = "Choose a tool from the list, then run it.";
  mcpSessionLine.textContent = "Channel session: not activated in this UI.";
  mcpSessionLine.classList.remove("active");
  mcpResult.textContent = "Explorer output will appear here after you run a tool.";
  mcpReceipt.textContent = "No receipt yet.";
  write("Click a demo step to begin.");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMcpFlow(step) {
  const steps = [...mcpFlow.querySelectorAll(".flow-step")];

  steps.forEach((item, index) => {
    item.classList.toggle("done", index < step);
    item.classList.toggle("active", index === step);
  });
}

function renderMcpTools(tools) {
  mcpTools = tools;
  if (!mcpTools.some((tool) => tool.name === selectedMcpTool)) {
    selectedMcpTool = mcpTools.find((tool) => tool._meta?.paid)?.name ?? mcpTools[0]?.name;
  }

  mcpToolList.innerHTML = tools
    .map((tool) => {
      const isPaid = Boolean(tool._meta?.paid);
      return `
        <button class="tool-chip ${isPaid ? "paid" : ""} ${
          tool.name === selectedMcpTool ? "selected" : ""
        }" data-tool-name="${escapeHtml(tool.name)}">
          <strong>${escapeHtml(tool.name)}</strong>
          <span>${escapeHtml(tool.description ?? "No description")}</span>
          <span>${isPaid ? `Paid: ${escapeHtml(tool._meta?.price ?? "")} ${escapeHtml(tool._meta?.token ?? "")}` : "Free"}</span>
        </button>
      `;
    })
    .join("");

  for (const button of mcpToolList.querySelectorAll("[data-tool-name]")) {
    button.addEventListener("click", () => selectMcpTool(button.dataset.toolName));
  }

  syncSelectedToolUi();
}

async function discoverMcpTools({ mirrorToOutput = false } = {}) {
  const result = await request("/api/mcp/tools");
  renderMcpTools(result.body.tools ?? []);
  setMcpFlow(0);
  mcpStatusLine.textContent = "MCP tools discovered. Pick a challenge or pay-and-run flow.";

  if (mirrorToOutput) write(result);
  return result;
}

function selectMcpTool(toolName) {
  selectedMcpTool = toolName;
  syncSelectedToolUi();
  setMcpFlow(0);
  write(`Selected MCP tool: ${toolName}`);
}

function selectedTool() {
  return mcpTools.find((tool) => tool.name === selectedMcpTool);
}

function syncSelectedToolUi() {
  const tool = selectedTool();
  mcpSelectedName.textContent = selectedMcpTool ?? "No tool selected";
  const needsLimit = selectedMcpTool === "explain_latest_transactions";

  for (const button of mcpToolList.querySelectorAll("[data-tool-name]")) {
    button.classList.toggle("selected", button.dataset.toolName === selectedMcpTool);
  }

  mcpLimitInput.disabled = !needsLimit;

  if (!tool) {
    mcpStatusLine.textContent = "Discover tools first, then select one.";
    return;
  }

  mcpStatusLine.textContent = tool._meta?.paid
    ? "Paid tool selected. Enter an account or leave blank for the buyer wallet."
    : "Free tool selected. Account input is optional; blank uses the buyer wallet.";
}

function selectedToolArguments() {
  const args = {};
  const account = mcpAccountInput.value.trim();
  const limit = Number(mcpLimitInput.value);

  if (account) args.account = account;
  if (selectedMcpTool === "explain_latest_transactions" && Number.isFinite(limit)) {
    args.limit = Math.min(Math.max(Math.trunc(limit), 1), 10);
  }

  return args;
}

function parseToolPayload(body) {
  const text = body?.content?.find((item) => item.type === "text")?.text;

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function findReceipt(body) {
  return body?.receipt ?? body?._meta?.["org.paymentauth/receipt"];
}

function renderPaymentChallenge(result) {
  const challenge = result.body?.data?.challenges?.[0];

  mcpSelectedName.textContent = challenge?.opaque?.tool ?? selectedMcpTool;
  mcpStatusLine.textContent =
    "The MCP server refused the premium tool call until the client attaches an MPP credential.";
  setMcpFlow(1);
  mcpResult.innerHTML = `
    <p class="receipt-pill">Payment Required</p>
    <div class="metric-grid">
      <div class="metric">
        <span>Tool</span>
        <strong>${escapeHtml(challenge?.opaque?.tool ?? "premium tool")}</strong>
      </div>
      <div class="metric">
        <span>Amount</span>
        <strong>${escapeHtml(challenge?.request?.amount ?? "unknown")} base units</strong>
      </div>
      <div class="metric">
        <span>Method</span>
        <strong>${escapeHtml(challenge?.method ?? "stellar")}</strong>
      </div>
      <div class="metric">
        <span>Intent</span>
        <strong>${escapeHtml(challenge?.intent ?? "charge")}</strong>
      </div>
    </div>
    <p class="callout">${escapeHtml(result.body?.message ?? "Payment is required before tool execution.")}</p>
  `;
  mcpReceipt.innerHTML = `
    <p class="callout">
      No receipt yet. Click <strong>Pay + run charge</strong> or <strong>Pay + run channel</strong>;
      the MPP client will pay, retry the same MCP tool call, and render the unlocked result here.
    </p>
  `;
}

function renderPaidToolResult(result, label) {
  const payload = parseToolPayload(result.body);
  const receipt = findReceipt(result.body);

  if (!payload) {
    mcpResult.textContent = "Tool returned no text payload.";
    mcpReceipt.textContent = receipt ? "Receipt attached." : "No receipt attached.";
    return;
  }

  mcpSelectedName.textContent = payload.tool ?? selectedMcpTool;
  mcpStatusLine.textContent = `Ran ${payload.tool ?? "paid tool"} with ${label}.`;
  setMcpFlow(3);
  const payerContext = payload.mppPayerAccount
    ? `
    <div class="metric-grid payer-context">
      <div class="metric">
        <span>MPP payer (demo buyer)</span>
        <strong>${escapeHtml(payload.mppPayerAccount)}</strong>
      </div>
      <div class="metric">
        <span>Analyzed Horizon account</span>
        <strong>${escapeHtml(
          payload.inspectedAccount ??
            payload.account ??
            payload.target?.account ??
            payload.accountLookup?.account ??
            "—",
        )}</strong>
      </div>
    </div>`
    : "";
  mcpResult.innerHTML = `
    ${payerContext}
    <div class="metric-grid">
      <div class="metric">
        <span>Tool</span>
        <strong>${escapeHtml(payload.tool ?? selectedMcpTool)}</strong>
      </div>
      <div class="metric">
        <span>Result Type</span>
        <strong>${escapeHtml(payload.resultType ?? "tool-result")}</strong>
      </div>
      <div class="metric">
        <span>Mode</span>
        <strong>${escapeHtml(payload.mode ?? "free")}</strong>
      </div>
      <div class="metric">
        <span>Paid</span>
        <strong>${payload.paid ? "yes" : "no"}</strong>
      </div>
    </div>
    ${renderToolPayloadDetails(payload)}
    <p class="callout">${escapeHtml(payload.message ?? "Paid MCP tool completed.")}</p>
  `;
  mcpReceipt.innerHTML = receipt
    ? `
      <p class="receipt-pill">Receipt attached</p>
      <div class="metric">
        <span>Challenge</span>
        <strong>${escapeHtml(receipt.challengeId ?? receipt.challenge?.id ?? "paid")}</strong>
      </div>
      <p class="callout">This receipt came back in MCP result metadata, not an HTTP header.</p>
      <p class="callout">
        The receipt proves the <strong>demo buyer / agent wallet</strong> paid MPP for this tool call.
        The <strong>Account input</strong> field only chooses which address is fetched from Horizon—not who funded the micropayment.
      </p>
    `
    : `<p class="callout">Tool succeeded, but no receipt metadata was returned.</p>`;
}

function renderFreeToolResult(result) {
  const payload = parseToolPayload(result.body);

  mcpSelectedName.textContent = payload?.tool ?? selectedMcpTool;
  mcpStatusLine.textContent = "Free MCP tool completed without a payment challenge.";
  setMcpFlow(3);
  mcpResult.innerHTML = `
    <div class="metric-grid">
      <div class="metric">
        <span>Tool</span>
        <strong>${escapeHtml(payload?.tool ?? selectedMcpTool)}</strong>
      </div>
      <div class="metric">
        <span>Result Type</span>
        <strong>${escapeHtml(payload?.resultType ?? "free-result")}</strong>
      </div>
    </div>
    ${renderToolPayloadDetails(payload ?? {})}
    <p class="callout">${escapeHtml(payload?.message ?? "Free MCP tool completed.")}</p>
  `;
  mcpReceipt.innerHTML = `<p class="callout">Free tools do not need a receipt.</p>`;
}

function renderToolPayloadDetails(payload) {
  if (payload.network) {
    return `
      <div class="metric-grid">
        <div class="metric"><span>Network</span><strong>${escapeHtml(payload.network.name)}</strong></div>
        <div class="metric"><span>RPC Healthy</span><strong>${payload.network.rpcHealthy ? "yes" : "no"}</strong></div>
        <div class="metric"><span>RPC URL</span><strong>${escapeHtml(payload.network.rpcUrl)}</strong></div>
        <div class="metric"><span>Horizon URL</span><strong>${escapeHtml(payload.network.horizonUrl)}</strong></div>
      </div>
    `;
  }

  if (payload.accountLookup) {
    return `
      <div class="metric-grid">
        <div class="metric"><span>Account</span><strong>${escapeHtml(payload.accountLookup.account)}</strong></div>
        <div class="metric"><span>Exists</span><strong>${payload.accountLookup.exists ? "yes" : "no"}</strong></div>
        <div class="metric"><span>XLM Balance</span><strong>${escapeHtml(payload.accountLookup.xlm)}</strong></div>
        <div class="metric"><span>Fallback</span><strong>${payload.accountLookup.fallbackUsed ? "buyer wallet" : "custom input"}</strong></div>
      </div>
    `;
  }

  if (payload.riskChecks) {
    return `
      <div class="metric-grid">
        ${payload.riskChecks
          .map(
            (item) => `
              <div class="metric">
                <span>${escapeHtml(item.label)}</span>
                <strong>${item.ok ? "ok" : "needs attention"}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  if (payload.transactions) {
    return `
      <div class="metric">
        <span>Account</span>
        <strong>${escapeHtml(payload.account ?? "unknown")}</strong>
      </div>
      ${payload.transactions
        .map(
          (transaction) => `
            <div class="metric">
              <span>${escapeHtml(transaction.createdAt ?? "recent transaction")}</span>
              <strong>${escapeHtml(transaction.explanation)}</strong>
              ${transaction.hash ? `<code>${escapeHtml(transaction.hash)}</code>` : ""}
            </div>
          `,
        )
        .join("")}
    `;
  }

  if (payload.channel) {
    return `
      <div class="metric-grid">
        <div class="metric"><span>Channel</span><strong>${escapeHtml(payload.channel.contract ?? "n/a")}</strong></div>
        <div class="metric"><span>Balance Base Units</span><strong>${escapeHtml(payload.channel.balanceBaseUnits ?? "n/a")}</strong></div>
        <div class="metric"><span>Current Ledger</span><strong>${escapeHtml(payload.channel.currentLedger ?? "n/a")}</strong></div>
        <div class="metric"><span>Close Ledger</span><strong>${escapeHtml(payload.channel.closeEffectiveAtLedger ?? "n/a")}</strong></div>
      </div>
    `;
  }

  if (payload.target) {
    return `
      <div class="metric-grid">
        <div class="metric"><span>Target</span><strong>${escapeHtml(payload.target.account)}</strong></div>
        <div class="metric"><span>Target XLM</span><strong>${escapeHtml(payload.target.xlm)}</strong></div>
      </div>
    `;
  }

  return "";
}

async function runSelectedMcpTool() {
  const tool = selectedTool();

  if (!tool) {
    write("Discover and select an MCP tool first.");
    return;
  }

  if (!tool._meta?.paid) {
    const result = await request("/api/mcp/free", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: selectedMcpTool, arguments: selectedToolArguments() }),
    });
    renderFreeToolResult(result);
    write(result);
    return;
  }

  if (mcpPaymentMode.value === "channel") {
    if (!channelSessionActive) {
      mcpStatusLine.textContent = "Activate the channel session once, then run paid tools through it.";
      setMcpFlow(1);
      write("Channel session is not active in the UI yet.");
      return;
    }

    setMcpFlow(2);
    mcpStatusLine.textContent =
      "Using active channel session. This signs a voucher, not a new on-chain transaction.";
    const result = await request("/api/mcp/channel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: selectedMcpTool, arguments: selectedToolArguments() }),
    });
    renderPaidToolResult(result, "channel session");
    write(result);
    return;
  }

  setMcpFlow(2);
  mcpStatusLine.textContent = "Paying this selected tool with MPP charge...";
  const result = await request("/api/mcp/charge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolName: selectedMcpTool, mode: "pull", arguments: selectedToolArguments() }),
  });
  renderPaidToolResult(result, "charge pull");
  write(result);
  await loadWallets();
}

async function activateChannelSession() {
  const result = await request("/api/mcp/channel/session", { method: "POST" });

  channelSessionActive = Boolean(result.body.active);
  mcpPaymentMode.value = "channel";
  mcpSessionLine.textContent = channelSessionActive
    ? "Channel session: active. Paid tool runs will use off-chain vouchers."
    : "Channel session: not active.";
  mcpSessionLine.classList.toggle("active", channelSessionActive);
  setMcpFlow(2);
  mcpStatusLine.textContent =
    "Channel access activated. Choose any paid tool and click Run selected tool.";
  mcpReceipt.innerHTML = `
    <p class="receipt-pill">Channel ready</p>
    <p class="callout">${escapeHtml(result.body.note ?? "Channel session is active.")}</p>
  `;
  if (result.body.channel) {
    mcpResult.innerHTML = renderToolPayloadDetails({
      channel: result.body.channel,
      message: "Channel session activated.",
    });
  }
  write(result);
}

function walletCard(wallet) {
  const balance = wallet.balance
    ? `${wallet.balance.xlm} XLM${wallet.balance.exists ? "" : " (not funded)"}`
    : "not a payment account";
  const fundButton = wallet.canFund
    ? `<button class="mini" data-fund-role="${wallet.role}">Fund on Testnet</button>`
    : "";

  return `
    <article class="wallet-card">
      <div>
        <p class="wallet-role">${wallet.label}</p>
        <code>${wallet.publicKey ?? wallet.missingReason}</code>
      </div>
      <p>${wallet.purpose}</p>
      <strong>${balance}</strong>
      ${fundButton}
    </article>
  `;
}

async function loadWallets() {
  const result = await request("/api/wallets");
  wallets.innerHTML = result.body.wallets.map(walletCard).join("");

  for (const button of wallets.querySelectorAll("[data-fund-role]")) {
    button.addEventListener("click", async () => {
      setBusy(true);
      write(`Funding ${button.dataset.fundRole} with Friendbot...`);

      try {
        write(
          await request("/api/wallets/fund", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: button.dataset.fundRole }),
          }),
        );
        await loadWallets();
      } catch (error) {
        write({ error: error.message });
      } finally {
        setBusy(false);
      }
    });
  }
}

function setBusy(isBusy) {
  for (const button of buttons) {
    button.disabled = isBusy;
  }
}

async function loadStatus() {
  try {
    const result = await request("/api/status");
    if (result.status >= 400 || !result.body?.modeSupport) {
      throw new Error(`Status endpoint returned ${result.status}`);
    }

    status.textContent = `${result.body.price} on ${result.body.network} | fee sponsor: ${
      result.body.modeSupport.feeSponsoredPull ? "configured" : "not configured"
    }`;
  } catch (error) {
    status.textContent = "Demo API unavailable";
    write(error.message);
    return;
  }

  try {
    await loadWallets();
  } catch (error) {
    wallets.textContent = "Wallet data could not be loaded.";
    write(error.message);
  }

  try {
    await discoverMcpTools();
  } catch (error) {
    mcpToolList.textContent = "MCP tools could not be loaded.";
    write(error.message);
  }
}

async function runAction(action) {
  setBusy(true);

  try {
    if (action === "free") {
      write(await request("/api/free-insight"));
      return;
    }

    if (action === "challenge") {
      write(await request("/api/paid-insight"));
      return;
    }

    if (action === "pay") {
      write("Use pull or push mode explicitly.");
      return;
    }

    if (action === "pay-pull") {
      write("Paying with charge pull mode...");
      write(
        await request("/api/demo-pay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "pull" }),
        }),
      );
      await loadWallets();
      return;
    }

    if (action === "pay-push") {
      write("Paying with charge push mode...");
      write(
        await request("/api/demo-pay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "push" }),
        }),
      );
      await loadWallets();
      return;
    }

    if (action === "wallets") {
      await loadWallets();
      write(await request("/api/wallets"));
      return;
    }

    if (action === "channel-open") {
      write(await request("/api/channel/open", { method: "POST" }));
      return;
    }

    if (action === "channel-request") {
      write(await request("/api/channel/request", { method: "POST" }));
      return;
    }

    if (action === "channel-close") {
      write(await request("/api/channel/close", { method: "POST" }));
      return;
    }

    if (action === "channel-state") {
      write(await request("/api/channel/state"));
      return;
    }

    if (action === "mcp-tools") {
      await discoverMcpTools({ mirrorToOutput: true });
      return;
    }

    if (action === "mcp-free") {
      selectedMcpTool = "lookup_account";
      syncSelectedToolUi();
      const result = await request("/api/mcp/free", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: selectedMcpTool, arguments: selectedToolArguments() }),
      });
      renderFreeToolResult(result);
      write(result);
      return;
    }

    if (action === "mcp-no-payment") {
      const result = await request("/api/mcp/no-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: selectedMcpTool,
          paymentMode: mcpPaymentMode.value,
          arguments: selectedToolArguments(),
        }),
      });
      renderPaymentChallenge(result);
      write(result);
      return;
    }

    if (action === "mcp-charge") {
      write("Calling paid MCP tool with MPP charge...");
      setMcpFlow(2);
      mcpSelectedName.textContent = selectedMcpTool;
      mcpStatusLine.textContent = "Paying on-chain with MPP charge, then retrying the MCP tool call...";
      const result = await request("/api/mcp/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "pull",
          toolName: selectedMcpTool,
          arguments: selectedToolArguments(),
        }),
      });
      renderPaidToolResult(result, "charge pull");
      write(result);
      await loadWallets();
      return;
    }

    if (action === "mcp-channel") {
      write("Calling paid MCP tool with MPP channel voucher...");
      setMcpFlow(2);
      mcpSelectedName.textContent = selectedMcpTool;
      mcpStatusLine.textContent =
        "Signing a cumulative channel voucher, then retrying the MCP tool call...";
      const result = await request("/api/mcp/channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: selectedMcpTool, arguments: selectedToolArguments() }),
      });
      renderPaidToolResult(result, "channel voucher");
      write(result);
      return;
    }

    if (action === "mcp-workbench-discover") {
      await discoverMcpTools();
      write("MCP tools loaded in the workbench.");
      return;
    }

    if (action === "mcp-workbench-challenge") {
      const tool = selectedTool();
      if (!tool?._meta?.paid) {
        write("Selected tool is free; it does not produce a payment challenge.");
        mcpStatusLine.textContent = "Free tools can run directly without payment.";
        return;
      }
      const result = await request("/api/mcp/no-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: selectedMcpTool,
          paymentMode: mcpPaymentMode.value,
          arguments: selectedToolArguments(),
        }),
      });
      renderPaymentChallenge(result);
      write("The premium MCP tool returned a payment-required challenge.");
      return;
    }

    if (action === "mcp-workbench-charge") {
      setMcpFlow(2);
      mcpSelectedName.textContent = selectedMcpTool;
      mcpStatusLine.textContent = "Paying with MPP charge and running the paid MCP tool...";
      const result = await request("/api/mcp/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "pull",
          toolName: selectedMcpTool,
          arguments: selectedToolArguments(),
        }),
      });
      renderPaidToolResult(result, "charge pull");
      write("Paid MCP charge tool completed. See the MCP Workbench for the usable result.");
      await loadWallets();
      return;
    }

    if (action === "mcp-workbench-channel") {
      if (!channelSessionActive) await activateChannelSession();
      await runSelectedMcpTool();
      return;
    }

    if (action === "mcp-workbench-channel-session") {
      await activateChannelSession();
      return;
    }

    if (action === "mcp-workbench-run") {
      await runSelectedMcpTool();
      return;
    }

    if (action === "clear") {
      resetDemoWorkbenchAndOutput();
    }
  } catch (error) {
    write({
      error: error.message,
    });
  } finally {
    setBusy(false);
  }
}

for (const button of buttons) {
  button.addEventListener("click", () => runAction(button.dataset.action));
}

loadStatus();
