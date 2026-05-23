(function () {
  const SESSION_STORAGE_KEY = "pdfEditor.session";
  const COMPRESS_SESSION_STORAGE_KEY = "pdfEditor.compressToolSessionId";
  const EDIT_SESSION_STORAGE_KEY = "pdfEditor.editToolSessionId";
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  document.addEventListener("DOMContentLoaded", function () {
    renderAuthActions();
    highlightActiveNavigation();
    initializeHomePage();
    initializeLoginPage();
    initializeSignupPage();
    initializeCompressPage();
    initializeEditPage();
  });

  function initializeHomePage() {
    if (document.body.dataset.page !== "home") {
      return;
    }

    document.querySelectorAll("[data-home-tool]").forEach(function (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();

        const tool = form.dataset.homeTool;
        const fileInput = form.querySelector(".file-input");
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
        const statusElement = document.querySelector(`[data-home-status="${tool}"]`);
        const validationMessage = validatePdfFile(file);

        if (validationMessage) {
          setStatus(statusElement, validationMessage, true);
          return;
        }

        setStatus(statusElement, "Uploading your PDF...", false);

        try {
          const session = await createToolSession(file, "");
          persistToolSession(tool, session.toolSessionId);
          window.location.href = `/${tool}?toolSessionId=${session.toolSessionId}`;
        } catch (error) {
          setStatus(statusElement, error.message, true);
        }
      });
    });
  }

  function initializeLoginPage() {
    const form = document.getElementById("login-form");
    if (!form) {
      return;
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const statusElement = document.getElementById("login-status");
      const emailAddress = document.getElementById("email-address").value.trim();
      const password = document.getElementById("password").value;

      if (!emailAddress || !password) {
        setStatus(statusElement, "Please enter your email address and password.", true);
        return;
      }

      setStatus(statusElement, "Signing you in...", false);

      try {
        const response = await fetchJson("/api/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailAddress, password })
        });

        setSession(response);
        setStatus(statusElement, "Login successful. Sending you back...", false);
        const returnUrl = new URLSearchParams(window.location.search).get("returnUrl") || "/";
        window.location.href = returnUrl;
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });
  }

  function initializeSignupPage() {
    const form = document.getElementById("signup-form");
    if (!form) {
      return;
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const statusElement = document.getElementById("signup-status");
      const firstName = document.getElementById("signup-first-name").value.trim();
      const lastName = document.getElementById("signup-last-name").value.trim();
      const emailAddress = document.getElementById("signup-email-address").value.trim();
      const password = document.getElementById("signup-password").value;
      const confirmPassword = document.getElementById("signup-confirm-password").value;

      if (!firstName || !lastName || !emailAddress || !password || !confirmPassword) {
        setStatus(statusElement, "Please fill in every field before creating your account.", true);
        return;
      }

      if (!emailAddress.includes("@")) {
        setStatus(statusElement, "Please enter a real email address.", true);
        return;
      }

      if (password.length < 8) {
        setStatus(statusElement, "Your password needs at least 8 characters.", true);
        return;
      }

      if (password !== confirmPassword) {
        setStatus(statusElement, "Password and confirmation password must match.", true);
        return;
      }

      setStatus(statusElement, "Creating your account...", false);

      try {
        const response = await fetchJson("/api/v1/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName,
            lastName,
            emailAddress,
            password,
            confirmPassword
          })
        });

        setSession(response);
        setStatus(statusElement, "Your account is ready. Sending you back...", false);
        const returnUrl = new URLSearchParams(window.location.search).get("returnUrl") || "/";
        window.location.href = returnUrl;
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });
  }

  function initializeCompressPage() {
    if (document.body.dataset.page !== "compress") {
      return;
    }

    const uploadForm = document.getElementById("compress-upload-form");
    const statusElement = document.getElementById("compress-status");
    const runButton = document.getElementById("run-compression");
    const saveButton = document.getElementById("save-compressed-document");

    uploadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const file = document.getElementById("compress-file").files[0];
      const title = document.getElementById("compress-title").value.trim();
      const validationMessage = validatePdfFile(file);

      if (validationMessage) {
        setStatus(statusElement, validationMessage, true);
        return;
      }

      setStatus(statusElement, "Uploading your PDF...", false);

      try {
        const session = await createToolSession(file, title);
        persistToolSession("compress", session.toolSessionId);
        syncToolSessionInUrl(session.toolSessionId);
        renderCompressSession(session);
        setStatus(statusElement, "Your PDF is ready. Choose a profile and run compression.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    runButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("compress");
      const profile = document.getElementById("compress-profile").value;

      if (!toolSessionId) {
        setStatus(statusElement, "Upload a PDF before you run compression.", true);
        return;
      }

      setStatus(statusElement, "Compressing your PDF...", false);

      try {
        const result = await compressToolSession(toolSessionId, profile);
        renderCompressSession(result.session);
        renderCompressionResult(result);
        setStatus(statusElement, "Compression finished. You can download or save the current PDF now.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    saveButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("compress");

      if (!toolSessionId) {
        setStatus(statusElement, "Upload a PDF before saving it.", true);
        return;
      }

      if (!getSession()) {
        window.location.href = createReturnUrl("/login");
        return;
      }

      setStatus(statusElement, "Saving your PDF into the application...", false);

      try {
        const response = await saveToolSession(toolSessionId, document.getElementById("compress-title").value.trim());
        setStatus(statusElement, `Saved successfully as "${response.document.title}".`, false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    const existingToolSessionId = getActiveToolSessionId("compress");
    if (existingToolSessionId) {
      loadCompressSession(existingToolSessionId);
    }
  }

  function initializeEditPage() {
    if (document.body.dataset.page !== "edit") {
      return;
    }

    const uploadForm = document.getElementById("edit-upload-form");
    const statusElement = document.getElementById("edit-status");
    const operationStatusElement = document.getElementById("edit-operation-status");
    const saveButton = document.getElementById("save-edited-document");

    uploadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const file = document.getElementById("edit-file").files[0];
      const title = document.getElementById("edit-title").value.trim();
      const validationMessage = validatePdfFile(file);

      if (validationMessage) {
        setStatus(statusElement, validationMessage, true);
        return;
      }

      setStatus(statusElement, "Uploading your PDF into the editor...", false);

      try {
        const session = await createToolSession(file, title);
        persistToolSession("edit", session.toolSessionId);
        syncToolSessionInUrl(session.toolSessionId);
        renderEditSession(session);
        setStatus(statusElement, "Your PDF is loaded in the editor.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    bindEditOperation("rotate-inline-form", async function () {
      const toolSessionId = requireEditToolSession(statusElement);
      const pageNumbers = parseNumberList(document.getElementById("rotate-page-numbers").value);
      const degrees = Number(document.getElementById("rotate-degrees").value);

      if (!toolSessionId) {
        return;
      }

      if (pageNumbers.length === 0) {
        throw new Error("Enter at least one page number to rotate.");
      }

      return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/rotate-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumbers, degrees })
      });
    });

    bindEditOperation("delete-inline-form", async function () {
      const toolSessionId = requireEditToolSession(statusElement);
      const pageNumbers = parseNumberList(document.getElementById("delete-page-numbers").value);

      if (!toolSessionId) {
        return;
      }

      if (pageNumbers.length === 0) {
        throw new Error("Enter at least one page number to delete.");
      }

      return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/delete-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumbers })
      });
    });

    bindEditOperation("reorder-inline-form", async function () {
      const toolSessionId = requireEditToolSession(statusElement);
      const orderedPageNumbers = parseNumberList(document.getElementById("reorder-page-numbers").value);

      if (!toolSessionId) {
        return;
      }

      if (orderedPageNumbers.length === 0) {
        throw new Error("Enter the full page order before reordering.");
      }

      return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/reorder-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedPageNumbers })
      });
    });

    saveButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("edit");

      if (!toolSessionId) {
        setStatus(statusElement, "Upload a PDF before saving it.", true);
        return;
      }

      if (!getSession()) {
        window.location.href = createReturnUrl("/login");
        return;
      }

      setStatus(statusElement, "Saving your edited PDF...", false);

      try {
        const response = await saveToolSession(toolSessionId, document.getElementById("edit-title").value.trim());
        setStatus(statusElement, `Saved successfully as "${response.document.title}".`, false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    const existingToolSessionId = getActiveToolSessionId("edit");
    if (existingToolSessionId) {
      loadEditSession(existingToolSessionId);
    }

    function bindEditOperation(formId, action) {
      const form = document.getElementById(formId);
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        setStatus(operationStatusElement, "Applying your page operation...", false);

        try {
          const session = await action();
          if (!session) {
            return;
          }

          renderEditSession(session);
          setStatus(operationStatusElement, session.lastOperationSummary || "Page operation completed successfully.", false);
        } catch (error) {
          setStatus(operationStatusElement, error.message, true);
        }
      });
    }
  }

  async function loadCompressSession(toolSessionId) {
    const statusElement = document.getElementById("compress-status");

    try {
      const session = await fetchToolSession(toolSessionId);
      renderCompressSession(session);
      setStatus(statusElement, "Existing compression session loaded.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  async function loadEditSession(toolSessionId) {
    const statusElement = document.getElementById("edit-status");

    try {
      const session = await fetchToolSession(toolSessionId);
      renderEditSession(session);
      setStatus(statusElement, "Existing editing session loaded.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  function renderCompressSession(session) {
    renderToolSessionSummary("compress-session-summary", session);
    renderPdfViewer("compress-pdf-viewer", session);
    toggleDownloadLink("download-compressed-file", session.downloadUrl, true);
  }

  function renderEditSession(session) {
    renderToolSessionSummary("edit-document-summary", session);
    renderPdfViewer("edit-pdf-viewer", session);
    toggleDownloadLink("download-edited-file", session.downloadUrl, true);
  }

  function renderToolSessionSummary(elementId, session) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    element.classList.remove("empty-state");
    element.innerHTML = [
      createMetaCard("Title", session.title),
      createMetaCard("File name", session.originalFileName),
      createMetaCard("Current size", formatBytes(session.fileSizeInBytes)),
      createMetaCard("Pages", String(session.pageCount)),
      createMetaCard("Last action", session.lastOperationName || "Original upload"),
      createMetaCard("Updated", new Date(session.updatedOnUtc).toLocaleString())
    ].join("");
  }

  function renderCompressionResult(result) {
    const element = document.getElementById("compress-result");
    if (!element) {
      return;
    }

    const percent = (result.compressionRatio * 100).toFixed(1);
    element.innerHTML = `
      <strong>Compression completed</strong>
      <span>Profile: ${escapeHtml(result.compressionProfile)}</span>
      <span>Original size: ${formatBytes(result.originalSizeInBytes)}</span>
      <span>Compressed size: ${formatBytes(result.compressedSizeInBytes)}</span>
      <span>Size change: ${percent}%</span>
      <span>Processing time: ${result.processingDurationMilliseconds} ms</span>
    `;
  }

  function renderPdfViewer(viewerId, session) {
    const viewer = document.getElementById(viewerId);
    if (!viewer) {
      return;
    }

    const cacheBust = `v=${Date.now()}`;
    viewer.src = session.fileUrl.includes("?")
      ? `${session.fileUrl}&${cacheBust}`
      : `${session.fileUrl}?${cacheBust}`;
  }

  function toggleDownloadLink(elementId, url, enabled) {
    const link = document.getElementById(elementId);
    if (!link) {
      return;
    }

    link.href = enabled ? url : "#";
    link.classList.toggle("disabled-link", !enabled);
    link.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  async function createToolSession(file, title) {
    const formData = new FormData();
    formData.append("title", title || "");
    formData.append("file", file);

    return fetchJson("/api/v1/tool-sessions", {
      method: "POST",
      body: formData
    });
  }

  async function fetchToolSession(toolSessionId) {
    return fetchJson(`/api/v1/tool-sessions/${toolSessionId}`);
  }

  async function compressToolSession(toolSessionId, compressionProfile) {
    return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/compress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compressionProfile })
    });
  }

  async function saveToolSession(toolSessionId, title) {
    return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/save`, {
      method: "POST",
      headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title: title || "" })
    });
  }

  function requireEditToolSession(statusElement) {
    const toolSessionId = getActiveToolSessionId("edit");
    if (!toolSessionId) {
      setStatus(statusElement, "Upload a PDF before using the editor tools.", true);
      return "";
    }

    return toolSessionId;
  }

  function renderAuthActions() {
    const authActionsElements = document.querySelectorAll("[data-auth-actions]");
    const session = getSession();

    authActionsElements.forEach(function (element) {
      if (session) {
        element.innerHTML = `
          <div class="auth-actions-group">
            <span class="auth-chip">${escapeHtml(session.displayName || session.emailAddress)}</span>
            <button class="secondary-button" type="button" data-logout-button>Logout</button>
          </div>
        `;
        return;
      }

      element.innerHTML = `
        <div class="auth-actions-group">
          <a class="secondary-button" href="${createReturnUrl("/login")}">Login</a>
          <a class="primary-button" href="${createReturnUrl("/signup")}">Sign up</a>
        </div>
      `;
    });

    document.querySelectorAll("[data-logout-button]").forEach(function (button) {
      button.addEventListener("click", function () {
        clearSession();
        window.location.reload();
      });
    });
  }

  function highlightActiveNavigation() {
    const pathname = window.location.pathname;
    document.querySelectorAll(".topnav a").forEach(function (link) {
      const href = link.getAttribute("href") || "";
      if (href === "/" ? pathname === "/" : pathname === href) {
        link.classList.add("nav-active");
      }
    });
  }

  function validatePdfFile(file) {
    if (!file) {
      return "Please choose a PDF file first.";
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return "Only PDF files are allowed.";
    }

    if (file.size === 0) {
      return "The selected PDF is empty.";
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return "Please keep the file under 25 MB for this app.";
    }

    return "";
  }

  function createAuthorizedHeaders(additionalHeaders) {
    const headers = new Headers(additionalHeaders || {});
    const session = getSession();
    if (session && session.accessToken) {
      headers.set("Authorization", `Bearer ${session.accessToken}`);
    }
    return headers;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      if (isJson && payload && typeof payload === "object") {
        throw new Error(payload.message || payload.title || payload.detail || "Request failed.");
      }

      throw new Error(typeof payload === "string" && payload ? payload : "Request failed.");
    }

    return payload;
  }

  function getActiveToolSessionId(tool) {
    const querySessionId = new URLSearchParams(window.location.search).get("toolSessionId");
    if (querySessionId) {
      persistToolSession(tool, querySessionId);
      return querySessionId;
    }

    return window.localStorage.getItem(getToolStorageKey(tool)) || "";
  }

  function persistToolSession(tool, toolSessionId) {
    window.localStorage.setItem(getToolStorageKey(tool), toolSessionId);
  }

  function syncToolSessionInUrl(toolSessionId) {
    const url = new URL(window.location.href);
    url.searchParams.set("toolSessionId", toolSessionId);
    window.history.replaceState({}, "", url);
  }

  function getToolStorageKey(tool) {
    return tool === "compress" ? COMPRESS_SESSION_STORAGE_KEY : EDIT_SESSION_STORAGE_KEY;
  }

  function setSession(session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  function getSession() {
    const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) {
      return null;
    }

    try {
      return JSON.parse(rawSession);
    } catch (error) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  function clearSession() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function setStatus(element, message, isError) {
    if (!element) {
      return;
    }

    element.textContent = message;
    element.classList.toggle("status-error", !!isError);
    element.classList.toggle("status-success", !isError);
  }

  function parseNumberList(inputValue) {
    return inputValue
      .split(",")
      .map(function (value) { return Number(value.trim()); })
      .filter(function (value) { return Number.isInteger(value) && value > 0; });
  }

  function createReturnUrl(basePath) {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    return `${basePath}?returnUrl=${returnUrl}`;
  }

  function createMetaCard(label, value) {
    return `
      <div class="meta-card">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `;
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
