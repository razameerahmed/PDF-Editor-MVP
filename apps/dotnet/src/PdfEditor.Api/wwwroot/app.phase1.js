(function () {
  const SESSION_STORAGE_KEY = "pdfEditor.session";
  const TOOL_SESSION_STORAGE_KEYS = {
    compress: "pdfEditor.compressToolSessionId",
    edit: "pdfEditor.editToolSessionId",
    merge: "pdfEditor.mergeToolSessionId",
    split: "pdfEditor.splitToolSessionId",
    unlock: "pdfEditor.unlockToolSessionId"
  };
  const EDITOR_VIEWER_MODULE_URL = "/editor-viewer.mjs?v=20260413-1";
  const PAID_SUBSCRIPTION_TIER = "Paid";
  const EDITOR_TEXT_BLOCK_CLIPBOARD_MIME = "application/x-pdfeditor-detected-text-block";
  const EDITOR_LAYOUT_STORAGE_KEY = "pdfEditor.editorLayout";
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  let appGridMenuEventsBound = false;
  let editViewerPromise = null;
  let currentEditSession = null;
  const editorAnnotationState = {
    activePageNumber: 1,
    activeTool: "select",
    annotations: [],
    flashedAnnotationId: "",
    isPersisting: false,
    lastSavedSnapshot: "[]",
    pendingInteraction: null,
    pendingSavePromise: Promise.resolve(),
    saveTimer: 0,
    selectedAnnotationId: "",
    viewerReady: false
  };
  const editorTextState = {
    clipboardTextBlock: null,
    capabilities: [],
    detectedTextBlocks: [],
    documentFingerprintSha256: "",
    exactFontFamilies: new Map(),
    exactFontLoadPromises: new Map(),
    fontFallbackWarningKeys: new Set(),
    fontLoadFailureKeys: new Set(),
    fontRerenderHandle: 0,
    hitRegionCache: new Map(),
    editingTextBlockId: "",
    flashedTextBlockId: "",
    dragInteraction: null,
    installedFontNames: [],
    installedFontNamesPromise: null,
    inlineEditorAutoApplyTimer: 0,
    inlineEditorCommitPromise: Promise.resolve(),
    inlineEditorCommitTargetId: "",
    inlineEditorDirty: false,
    inlineEditorPendingFocus: false,
    inlineEditorSelectAllOnFocus: false,
    inlineEditorSourceText: "",
    inlineEditorValue: "",
    loadSequence: 0,
    operationStatusElement: null,
    pages: [],
    pendingOperationPromise: Promise.resolve(),
    pendingSelection: null,
    preservedSourceFallbackWarningIds: new Set(),
    textUndoInProgress: false,
    searchQuery: "",
    selectedViewerSelection: null,
    selectedViewerText: "",
    selectedTextBlockId: "",
    statusElement: null
  };
  const editorContextMenuState = {
    anchorPageNumber: 1,
    anchorPoint: { x: 0.18, y: 0.18 },
    operationStatusElement: null,
    statusElement: null
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderAuthActions();
    highlightActiveNavigation();
    initializeHomePage();
    initializeLoginPage();
    initializeSignupPage();
    initializeCompressPage();
    initializeEditPage();
    initializeMergePage();
    initializeSplitPage();
    initializeUnlockPage();
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
    const downloadLink = document.getElementById("download-compressed-file");
    bindTitleToFileName("compress-file", "compress-title");

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

      setStatus(statusElement, "Saving your PDF to your device...", false);

      try {
        const savedFileName = await saveToolSessionPdfToDevice(
          toolSessionId,
          document.getElementById("compress-title").value.trim(),
          "compressed-document.pdf"
        );
        setStatus(statusElement, `Saved successfully as "${savedFileName}".`, false);
      } catch (error) {
        if (error?.name === "AbortError") {
          setStatus(statusElement, "Save canceled.", false);
          return;
        }
        setStatus(statusElement, error.message, true);
      }
    });

    if (downloadLink) {
      downloadLink.addEventListener("click", async function (event) {
        if (downloadLink.classList.contains("disabled-link")) {
          event.preventDefault();
          return;
        }

        const toolSessionId = getActiveToolSessionId("compress");
        if (!toolSessionId) {
          event.preventDefault();
          setStatus(statusElement, "Upload a PDF before downloading it.", true);
          return;
        }

        event.preventDefault();
        setStatus(statusElement, "Downloading your PDF...", false);

        try {
          const downloadedFileName = await downloadToolSessionPdfToDevice(
            toolSessionId,
            document.getElementById("compress-title").value.trim(),
            "compressed-document.pdf"
          );
          setStatus(statusElement, `Downloaded "${downloadedFileName}".`, false);
        } catch (error) {
          setStatus(statusElement, error.message, true);
        }
      });
    }

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
    const downloadLink = document.getElementById("download-edited-file");
    bindTitleToFileName("edit-file", "edit-title");
    initializeEditorToolbar(statusElement, operationStatusElement);
    initializeEditorLayoutResizers();
    initializeEditorAnnotations(statusElement, operationStatusElement);
    initializeEditorTextEditing(statusElement, operationStatusElement);
    initializeEditorAttachments(statusElement, operationStatusElement);
    initializeEditorContextMenu(statusElement, operationStatusElement);

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
        renderEditSession(session, { focusCanvas: true, panelName: "edit", toolbarAction: "edit" });
        setStatus(statusElement, session.isProtected
          ? "This PDF is protected. Open Unlock PDF to remove protection before editing."
          : "Your PDF is loaded in the editor.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    bindEditOperation("rotate-inline-form", async function () {
      const toolSessionId = requireEditToolSession(statusElement);
      const pageNumbers = parseNumberList(document.getElementById("rotate-page-numbers").value);
      const degrees = Number(document.getElementById("rotate-degrees").value);

      if (!toolSessionId) {
        return null;
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
        return null;
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
        return null;
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

      setStatus(statusElement, "Saving your edited PDF to your device...", false);

      try {
        await flushPendingEditorAnnotationSave();
        const savedFileName = await saveToolSessionPdfToDevice(
          toolSessionId,
          document.getElementById("edit-title").value.trim(),
          currentEditSession?.originalFileName || "edited-document.pdf"
        );
        setStatus(statusElement, `Saved successfully as "${savedFileName}".`, false);
      } catch (error) {
        if (error?.name === "AbortError") {
          setStatus(statusElement, "Save canceled.", false);
          return;
        }
        setStatus(statusElement, error.message, true);
      }
    });

    if (downloadLink) {
      downloadLink.addEventListener("click", async function (event) {
        if (downloadLink.classList.contains("disabled-link")) {
          event.preventDefault();
          return;
        }

        const toolSessionId = getActiveToolSessionId("edit");
        if (!toolSessionId) {
          event.preventDefault();
          setStatus(statusElement, "Upload a PDF before downloading it.", true);
          return;
        }

        event.preventDefault();
        setStatus(statusElement, "Downloading your edited PDF...", false);

        try {
          await flushPendingEditorAnnotationSave();
          const downloadedFileName = await downloadToolSessionPdfToDevice(
            toolSessionId,
            document.getElementById("edit-title").value.trim(),
            currentEditSession?.originalFileName || "edited-document.pdf"
          );
          setStatus(statusElement, `Downloaded "${downloadedFileName}".`, false);
        } catch (error) {
          setStatus(statusElement, error.message, true);
        }
      });
    }

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
          await flushPendingEditorAnnotationSave();
          const session = await action();
          if (!session) {
            return;
          }

          renderEditSession(session, { panelName: "organize", toolbarAction: "organize" });
          setStatus(operationStatusElement, session.lastOperationSummary || "Page operation completed successfully.", false);
        } catch (error) {
          setStatus(operationStatusElement, error.message, true);
        }
      });
    }
  }

  function initializeMergePage() {
    if (document.body.dataset.page !== "merge") {
      return;
    }

    const form = document.getElementById("merge-upload-form");
    const fileInput = document.getElementById("merge-files");
    const selectedFilesElement = document.getElementById("merge-selected-files");
    const statusElement = document.getElementById("merge-status");
    const saveButton = document.getElementById("save-merged-document");
    const downloadLink = document.getElementById("download-merged-file");

    fileInput.addEventListener("change", function () {
      renderSelectedFiles(selectedFilesElement, Array.from(fileInput.files || []));
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const files = Array.from(fileInput.files || []);
      const title = document.getElementById("merge-title").value.trim();
      const validationMessage = validatePdfFiles(files, 2);

      if (validationMessage) {
        setStatus(statusElement, validationMessage, true);
        return;
      }

      setStatus(statusElement, "Merging your PDFs...", false);

      try {
        const session = await createMergedToolSession(files, title);
        persistToolSession("merge", session.toolSessionId);
        syncToolSessionInUrl(session.toolSessionId);
        renderMergeSession(session);
        setStatus(statusElement, "Your PDFs are merged and ready for download.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    saveButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("merge");

      if (!toolSessionId) {
        setStatus(statusElement, "Merge PDFs before saving the result.", true);
        return;
      }

      setStatus(statusElement, "Saving your merged PDF to your device...", false);

      try {
        const savedFileName = await saveToolSessionPdfToDevice(
          toolSessionId,
          document.getElementById("merge-title").value.trim(),
          "merged-document.pdf"
        );
        setStatus(statusElement, `Saved successfully as "${savedFileName}".`, false);
      } catch (error) {
        if (error?.name === "AbortError") {
          setStatus(statusElement, "Save canceled.", false);
          return;
        }
        setStatus(statusElement, error.message, true);
      }
    });

    if (downloadLink) {
      downloadLink.addEventListener("click", async function (event) {
        if (downloadLink.classList.contains("disabled-link")) {
          event.preventDefault();
          return;
        }

        const toolSessionId = getActiveToolSessionId("merge");
        if (!toolSessionId) {
          event.preventDefault();
          setStatus(statusElement, "Merge PDFs before downloading the result.", true);
          return;
        }

        event.preventDefault();
        setStatus(statusElement, "Downloading your merged PDF...", false);

        try {
          const downloadedFileName = await downloadToolSessionPdfToDevice(
            toolSessionId,
            document.getElementById("merge-title").value.trim(),
            "merged-document.pdf"
          );
          setStatus(statusElement, `Downloaded "${downloadedFileName}".`, false);
        } catch (error) {
          setStatus(statusElement, error.message, true);
        }
      });
    }

    const existingToolSessionId = getActiveToolSessionId("merge");
    if (existingToolSessionId) {
      loadMergeSession(existingToolSessionId);
    }
  }

  function initializeSplitPage() {
    if (document.body.dataset.page !== "split") {
      return;
    }

    const uploadForm = document.getElementById("split-upload-form");
    const statusElement = document.getElementById("split-status");
    const operationStatusElement = document.getElementById("split-operation-status");
    const addRangeButton = document.getElementById("add-split-range");
    const runSplitButton = document.getElementById("run-split");
    const splitRangesElement = document.getElementById("split-ranges");
    bindTitleToFileName("split-file", "split-title");

    ensureAtLeastOneSplitRange(splitRangesElement);

    addRangeButton.addEventListener("click", function () {
      splitRangesElement.appendChild(createSplitRangeRow(""));
    });

    splitRangesElement.addEventListener("click", function (event) {
      const removeButton = event.target.closest("[data-remove-range]");
      if (!removeButton) {
        return;
      }

      removeButton.closest(".range-row").remove();
      ensureAtLeastOneSplitRange(splitRangesElement);
    });

    uploadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const file = document.getElementById("split-file").files[0];
      const title = document.getElementById("split-title").value.trim();
      const validationMessage = validatePdfFile(file);

      if (validationMessage) {
        setStatus(statusElement, validationMessage, true);
        return;
      }

      setStatus(statusElement, "Uploading your PDF...", false);

      try {
        const session = await createToolSession(file, title);
        persistToolSession("split", session.toolSessionId);
        syncToolSessionInUrl(session.toolSessionId);
        renderSplitSession(session);
        setStatus(statusElement, "Source PDF ready. Define one or more ranges and run the split.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    runSplitButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("split");
      const pageRanges = Array.from(splitRangesElement.querySelectorAll("input"))
        .map(function (input) { return input.value.trim(); })
        .filter(function (value) { return value.length > 0; });

      if (!toolSessionId) {
        setStatus(operationStatusElement, "Upload a PDF before splitting it.", true);
        return;
      }

      if (pageRanges.length === 0) {
        setStatus(operationStatusElement, "Add at least one page range like 1-3 or 4-6.", true);
        return;
      }

      setStatus(operationStatusElement, "Splitting your PDF...", false);

      try {
        const session = await splitToolSession(toolSessionId, pageRanges);
        renderSplitSession(session);
        setStatus(operationStatusElement, session.lastOperationSummary || "Split completed successfully.", false);
      } catch (error) {
        setStatus(operationStatusElement, error.message, true);
      }
    });

    const existingToolSessionId = getActiveToolSessionId("split");
    if (existingToolSessionId) {
      loadSplitSession(existingToolSessionId);
    }
  }

  function initializeUnlockPage() {
    if (document.body.dataset.page !== "unlock") {
      return;
    }

    const uploadForm = document.getElementById("unlock-upload-form");
    const statusElement = document.getElementById("unlock-status");
    const operationStatusElement = document.getElementById("unlock-operation-status");
    const unlockButton = document.getElementById("unlock-pdf-action");
    const saveButton = document.getElementById("save-unlocked-document");
    const downloadLink = document.getElementById("download-unlocked-file");
    bindTitleToFileName("unlock-file", "unlock-title");

    uploadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const file = document.getElementById("unlock-file").files[0];
      const title = document.getElementById("unlock-title").value.trim();
      const validationMessage = validatePdfFile(file);

      if (validationMessage) {
        setStatus(statusElement, validationMessage, true);
        return;
      }

      setStatus(statusElement, "Uploading your PDF for unlock review...", false);

      try {
        const session = await createToolSession(file, title);
        persistToolSession("unlock", session.toolSessionId);
        syncToolSessionInUrl(session.toolSessionId);
        renderUnlockSession(session);
        setStatus(statusElement, session.isProtected
          ? "Protected PDF loaded. Enter the password if needed and unlock it."
          : "This PDF is not locked. You can download or save it as-is.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
      }
    });

    unlockButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("unlock");
      if (!toolSessionId) {
        setStatus(statusElement, "Upload a protected PDF before unlocking it.", true);
        return;
      }

      const session = getSession();
      if (!session) {
        window.location.href = createReturnUrl("/login");
        return;
      }

      if (session.subscriptionTier !== PAID_SUBSCRIPTION_TIER) {
        setStatus(statusElement, "Unlock PDF is available for paid users only.", true);
        return;
      }

      const password = document.getElementById("unlock-password").value || "";
      setStatus(statusElement, "Unlocking the protected PDF...", false);
      setStatus(operationStatusElement, "Unlocking the protected PDF...", false);

      try {
        const updatedSession = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/unlock`, {
          method: "POST",
          headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ password: password })
        });

        renderUnlockSession(updatedSession);
        document.getElementById("unlock-password").value = "";
        setStatus(statusElement, "The PDF is unlocked and ready.", false);
        setStatus(operationStatusElement, updatedSession.lastOperationSummary || "Unlocked the PDF successfully.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
        setStatus(operationStatusElement, error.message, true);
      }
    });

    saveButton.addEventListener("click", async function () {
      const toolSessionId = getActiveToolSessionId("unlock");
      if (!toolSessionId) {
        setStatus(statusElement, "Upload a PDF before saving it.", true);
        return;
      }

      setStatus(statusElement, "Saving your unlocked PDF to your device...", false);

      try {
        const savedFileName = await saveToolSessionPdfToDevice(
          toolSessionId,
          document.getElementById("unlock-title").value.trim(),
          "unlocked-document.pdf"
        );
        setStatus(statusElement, `Saved successfully as "${savedFileName}".`, false);
      } catch (error) {
        if (error?.name === "AbortError") {
          setStatus(statusElement, "Save canceled.", false);
          return;
        }
        setStatus(statusElement, error.message, true);
      }
    });

    if (downloadLink) {
      downloadLink.addEventListener("click", async function (event) {
        if (downloadLink.classList.contains("disabled-link")) {
          event.preventDefault();
          return;
        }

        const toolSessionId = getActiveToolSessionId("unlock");
        if (!toolSessionId) {
          event.preventDefault();
          setStatus(statusElement, "Upload a PDF before downloading it.", true);
          return;
        }

        event.preventDefault();
        setStatus(statusElement, "Downloading your PDF...", false);

        try {
          const downloadedFileName = await downloadToolSessionPdfToDevice(
            toolSessionId,
            document.getElementById("unlock-title").value.trim(),
            "unlocked-document.pdf"
          );
          setStatus(statusElement, `Downloaded "${downloadedFileName}".`, false);
        } catch (error) {
          setStatus(statusElement, error.message, true);
        }
      });
    }

    const existingToolSessionId = getActiveToolSessionId("unlock");
    if (existingToolSessionId) {
      loadUnlockSession(existingToolSessionId);
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
      renderEditSession(session, { focusCanvas: true, panelName: "edit", toolbarAction: "edit" });
      setStatus(statusElement, "Existing editing session loaded.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  async function loadMergeSession(toolSessionId) {
    const statusElement = document.getElementById("merge-status");

    try {
      const session = await fetchToolSession(toolSessionId);
      renderMergeSession(session);
      setStatus(statusElement, "Existing merge session loaded.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  async function loadSplitSession(toolSessionId) {
    const statusElement = document.getElementById("split-status");

    try {
      const session = await fetchToolSession(toolSessionId);
      renderSplitSession(session);
      setStatus(statusElement, "Existing split session loaded.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  async function loadUnlockSession(toolSessionId) {
    const statusElement = document.getElementById("unlock-status");

    try {
      const session = await fetchToolSession(toolSessionId);
      renderUnlockSession(session);
      setStatus(statusElement, session.isProtected
        ? "Existing unlock session loaded."
        : "Existing unlock session loaded. This PDF is not protected.", false);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  function renderCompressSession(session) {
    renderToolSessionSummary("compress-session-summary", session);
    renderPdfViewer("compress-pdf-viewer", session);
    toggleDownloadLink("download-compressed-file", session.downloadUrl, true);
    syncTitleInput("compress-title", session.title);
  }

  function renderEditSession(session, options) {
    const previousSession = currentEditSession;
    const settings = {
      focusCanvas: false,
      panelName: getActiveEditorPanelName(),
      preserveViewState: true,
      reloadDetectedText: true,
      reloadViewer: true,
      toolbarAction: getActiveToolbarAction(),
      ...(options || {})
    };

    currentEditSession = session;
    renderToolSessionSummary("edit-document-summary", session);
    hydrateEditorAnnotations(session.annotations || []);
    renderDocumentAttachmentList();
    renderAttachmentObjectList();
    renderUnlockState(session);

    if (!session.requiresPassword && settings.reloadDetectedText) {
      void loadDocumentSnapshot(session.toolSessionId);
    } else if (session.requiresPassword) {
      editorTextState.capabilities = [];
      editorTextState.detectedTextBlocks = [];
      editorTextState.documentFingerprintSha256 = "";
      clearDetectedTextHitRegionCache();
      editorTextState.pages = [];
      editorTextState.selectedTextBlockId = "";
      clearViewerTextSelection();
      renderDetectedTextBlocks();
    } else {
      renderDetectedTextBlocks();
    }

    if (settings.reloadViewer || shouldReloadEditViewer(previousSession, session)) {
      editorAnnotationState.viewerReady = false;
      void captureEditorViewerViewState().then(function (viewState) {
        renderEditPdfViewer(session, {
          viewState: settings.preserveViewState ? viewState : null
        });
      });
    } else {
      renderEditorAnnotations();
      renderDetectedTextBlocks();
      refreshEditorViewerLayout();
    }

    syncTitleInput("edit-title", session.title);

    const pageCountElement = document.getElementById("edit-page-count");
    if (pageCountElement) {
      pageCountElement.textContent = String(session.pageCount);
    }

    const reorderInput = document.getElementById("reorder-page-numbers");
    if (reorderInput && !reorderInput.value) {
      reorderInput.placeholder = buildFullOrderPlaceholder(session.pageCount);
    }

    const editorShell = document.getElementById("editor-shell");
    if (editorShell) {
      editorShell.classList.add("is-live");
    }
    document.body.classList.add("editor-live");

    toggleDownloadLink("download-edited-file", session.downloadUrl, true);
    activateEditorPanel(settings.panelName || "edit");
    activateToolbarButton(settings.toolbarAction || settings.panelName || "edit");
    if (settings.focusCanvas) {
      focusEditorCanvas();
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        refreshEditorViewerLayout();
      });
    });
  }

  function mergeCurrentEditSessionMetadata(session) {
    if (!session || typeof session !== "object") {
      return;
    }

    currentEditSession = currentEditSession
      ? { ...currentEditSession, ...session }
      : session;

    renderToolSessionSummary("edit-document-summary", currentEditSession);
    renderUnlockState(currentEditSession);
    syncTitleInput("edit-title", currentEditSession.title);
    toggleDownloadLink("download-edited-file", currentEditSession.downloadUrl, true);

    const pageCountElement = document.getElementById("edit-page-count");
    if (pageCountElement) {
      pageCountElement.textContent = String(currentEditSession.pageCount || 0);
    }

    const reorderInput = document.getElementById("reorder-page-numbers");
    if (reorderInput && !reorderInput.value) {
      reorderInput.placeholder = buildFullOrderPlaceholder(currentEditSession.pageCount || 0);
    }
  }

  function sortDetectedTextBlocksForEditor(textBlocks) {
    return (Array.isArray(textBlocks) ? textBlocks.slice() : []).sort(function (left, right) {
      if ((left.pageNumber || 0) !== (right.pageNumber || 0)) {
        return (left.pageNumber || 0) - (right.pageNumber || 0);
      }

      if ((left.y || 0) !== (right.y || 0)) {
        return (left.y || 0) - (right.y || 0);
      }

      if ((left.x || 0) !== (right.x || 0)) {
        return (left.x || 0) - (right.x || 0);
      }

      return String(left.text || "").localeCompare(String(right.text || ""));
    });
  }

  function replaceLocalDetectedTextBlocks(nextBlocks) {
    const previousSelectionId = editorTextState.selectedTextBlockId;
    clearDetectedTextHitRegionCache();
    editorTextState.detectedTextBlocks = sortDetectedTextBlocksForEditor(nextBlocks);
    editorTextState.selectedTextBlockId = resolveDetectedTextSelection(previousSelectionId);
    renderDetectedTextBlocks();
  }

  function applyLocalTextOperationResponse(response) {
    if (!response || typeof response !== "object") {
      return;
    }

    clearInlineDetectedTextEditState();
    mergeCurrentEditSessionMetadata(response.session);
    setPendingSelectionFromTextOperation(response.operation);
    clearViewerTextSelection();

    const resultTextBlock = response.operation?.resultTextBlock && typeof response.operation.resultTextBlock === "object"
      ? response.operation.resultTextBlock
      : null;
    const keepOriginal = !!response.operation?.keepOriginal;
    const sourceSelectionId = String(response.operation?.sourceTextObjectId || response.operation?.sourceTextBlockId || "");
    let nextBlocks = editorTextState.detectedTextBlocks.slice();

    if (sourceSelectionId && !keepOriginal) {
      nextBlocks = nextBlocks.filter(function (textBlock) {
        return getDetectedTextSelectionId(textBlock) !== sourceSelectionId;
      });
    }

    if (resultTextBlock) {
      const resultSelectionId = getDetectedTextSelectionId(resultTextBlock);
      nextBlocks = nextBlocks.filter(function (textBlock) {
        return getDetectedTextSelectionId(textBlock) !== resultSelectionId;
      });
      nextBlocks.push(resultTextBlock);
    }

    replaceLocalDetectedTextBlocks(nextBlocks);
    activateEditorPanel("edit");
    activateToolbarButton("edit");
    refreshEditorViewerLayout();
  }

  function shouldReloadEditViewer(previousSession, nextSession) {
    if (!previousSession || !nextSession) {
      return true;
    }

    return previousSession.fileUrl !== nextSession.fileUrl
      || previousSession.pageCount !== nextSession.pageCount
      || previousSession.requiresPassword !== nextSession.requiresPassword;
  }

  function getActiveEditorPanelName() {
    return document.querySelector(".sidebar-panel--active[data-editor-panel], .rail-panel--active[data-editor-panel]")?.dataset.editorPanel || "edit";
  }

  function getActiveToolbarAction() {
    return document.querySelector(".toolbar-button--active[data-toolbar-action]")?.dataset.toolbarAction || "edit";
  }

  function renderMergeSession(session) {
    renderToolSessionSummary("merge-session-summary", session);
    renderPdfViewer("merge-pdf-viewer", session);
    toggleDownloadLink("download-merged-file", session.downloadUrl, true);
  }

  function renderSplitSession(session) {
    renderToolSessionSummary("split-session-summary", session);
    renderPdfViewer("split-pdf-viewer", session);
    renderSplitArtifacts("split-results", session.splitArtifacts || []);
    syncTitleInput("split-title", session.title);
  }

  function renderUnlockSession(session) {
    renderToolSessionSummary("unlock-session-summary", session);
    syncTitleInput("unlock-title", session.title);
    toggleDownloadLink("download-unlocked-file", session.downloadUrl, true);

    const viewer = document.getElementById("unlock-pdf-viewer");
    const emptyState = document.getElementById("unlock-viewer-empty");
    const protectionSummary = document.getElementById("unlock-protection-summary");
    const tierChip = document.getElementById("unlock-tier-chip");
    const unlockButton = document.getElementById("unlock-pdf-action");
    const activeSession = getSession();
    const isPaidUser = activeSession?.subscriptionTier === PAID_SUBSCRIPTION_TIER;

    if (tierChip) {
      tierChip.textContent = activeSession?.subscriptionTier || "Free";
    }

    if (protectionSummary) {
      protectionSummary.textContent = session.isProtected
        ? (session.protectionSummary || "This PDF is protected and requires unlocking before editing.")
        : "This PDF is already unlocked and ready to use.";
    }

    if (unlockButton) {
      unlockButton.disabled = !session.isProtected || !isPaidUser;
    }

    if (viewer) {
      viewer.hidden = !!session.requiresPassword;
    }

    if (emptyState) {
      emptyState.hidden = !session.requiresPassword;
      emptyState.textContent = session.requiresPassword
        ? (isPaidUser
          ? "This PDF is protected. Enter the password if needed, then unlock it here."
          : "This PDF is protected. Unlock PDF is available for paid users only.")
        : "Upload a protected PDF to unlock it in this workspace.";
    }

    if (!session.requiresPassword) {
      renderPdfViewer("unlock-pdf-viewer", session);
    } else if (viewer) {
      viewer.removeAttribute("src");
    }
  }

  function renderToolSessionSummary(elementId, session) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    element.classList.remove("empty-state");
    const cards = [
      createMetaCard("Title", session.title),
      createMetaCard("File name", session.originalFileName),
      createMetaCard("Current size", formatBytes(session.fileSizeInBytes)),
      createMetaCard("Pages", String(session.pageCount)),
      createMetaCard("Last action", session.lastOperationName || "Original upload"),
      createMetaCard("Updated", new Date(session.updatedOnUtc).toLocaleString())
    ];

    if (session.isProtected) {
      cards.push(createMetaCard("Protection", session.protectionSummary || "Protected PDF"));
    }

    element.innerHTML = cards.join("");
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

    if (!session || !session.fileUrl) {
      viewer.removeAttribute("src");
      return;
    }

    const cacheBust = `v=${Date.now()}`;
    const baseUrl = session.fileUrl.includes("?")
      ? `${session.fileUrl}&${cacheBust}`
      : `${session.fileUrl}?${cacheBust}`;

    viewer.src = `${baseUrl}#toolbar=0&navpanes=0&statusbar=0&messages=0&zoom=page-width`;
  }

  function renderPageRail(elementId, pageCount) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    if (!pageCount || pageCount < 1) {
      element.innerHTML = '<div class="page-thumb empty-thumb">Upload a PDF to load page thumbnails.</div>';
      return;
    }

    element.innerHTML = Array.from({ length: pageCount }, function (_, index) {
      return `<button class="page-thumb${index === 0 ? " page-thumb--active" : ""}" type="button" data-page-thumb="${index + 1}">Page ${index + 1}</button>`;
    }).join("");
  }

  function renderSelectedFiles(element, files) {
    if (!element) {
      return;
    }

    if (!files.length) {
      element.innerHTML = '<span class="file-pill empty-pill">Select at least two PDF files to merge.</span>';
      return;
    }

    element.innerHTML = files.map(function (file, index) {
      return `<span class="file-pill">${index + 1}. ${escapeHtml(file.name)}</span>`;
    }).join("");
  }

  function renderSplitArtifacts(elementId, splitArtifacts) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    if (!splitArtifacts || splitArtifacts.length === 0) {
      element.innerHTML = `
        <div class="artifact-card artifact-card--empty">
          <strong>No split files yet</strong>
          <span>Run the split to generate downloadable PDFs for each range.</span>
        </div>
      `;
      return;
    }

    element.innerHTML = splitArtifacts.map(function (artifact) {
      return `
        <div class="artifact-card">
          <strong>${escapeHtml(artifact.fileName)}</strong>
          <span>Range: ${escapeHtml(artifact.pageRange)}</span>
          <span>Size: ${formatBytes(artifact.fileSizeInBytes)}</span>
          <a href="${escapeHtml(artifact.downloadUrl)}">Download split PDF</a>
        </div>
      `;
    }).join("");
  }

  function ensureAtLeastOneSplitRange(element) {
    if (!element.querySelector(".range-row")) {
      element.appendChild(createSplitRangeRow("1-1"));
    }
  }

  function createSplitRangeRow(initialValue) {
    const row = document.createElement("div");
    row.className = "range-row";
    row.innerHTML = `
      <label>
        <span>Page range</span>
        <input type="text" value="${escapeHtml(initialValue)}" placeholder="1-3" />
      </label>
      <div class="range-row__actions">
        <button type="button" data-remove-range aria-label="Remove range">Ã—</button>
      </div>
    `;
    return row;
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

  async function createMergedToolSession(files, title) {
    const formData = new FormData();
    formData.append("title", title || "");
    files.forEach(function (file) {
      formData.append("files", file);
    });

    return fetchJson("/api/v1/tool-sessions/merge", {
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

  async function splitToolSession(toolSessionId, pageRanges) {
    return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageRanges })
    });
  }

  async function saveToolSession(toolSessionId, title) {
    return fetchJson(`/api/v1/tool-sessions/${toolSessionId}/save`, {
      method: "POST",
      headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title: title || "" })
    });
  }

  async function fetchBlob(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      const payload = isJson ? await response.json() : await response.text();
      const isApiEnvelope = isJson &&
        payload &&
        typeof payload === "object" &&
        Object.prototype.hasOwnProperty.call(payload, "success") &&
        Object.prototype.hasOwnProperty.call(payload, "message");

      if (isApiEnvelope) {
        throw new Error(payload.message || "Request failed.");
      }

      if (isJson && payload && typeof payload === "object") {
        throw new Error(payload.message || payload.title || payload.detail || "Request failed.");
      }

      throw new Error(typeof payload === "string" && payload ? payload : "Request failed.");
    }

    return response.blob();
  }

  function buildPdfSaveFileName(title, fallbackFileName) {
    const fallbackBaseName = String(fallbackFileName || "document")
      .replace(/\.pdf$/i, "")
      .trim();
    const requestedBaseName = String(title || "").trim() || fallbackBaseName || "document";
    const sanitizedBaseName = requestedBaseName
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");

    const safeBaseName = sanitizedBaseName || "document";
    return safeBaseName.toLowerCase().endsWith(".pdf") ? safeBaseName : `${safeBaseName}.pdf`;
  }

  async function saveBlobToDevice(blob, fileName) {
    if (window.showSaveFilePicker) {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "PDF document",
            accept: { "application/pdf": [".pdf"] }
          }
        ]
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const linkElement = document.createElement("a");
    linkElement.href = blobUrl;
    linkElement.download = fileName;
    linkElement.rel = "noopener";
    document.body.appendChild(linkElement);
    linkElement.click();
    linkElement.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  }

  async function saveToolSessionPdfToDevice(toolSessionId, title, fallbackFileName) {
    const fileName = buildPdfSaveFileName(title, fallbackFileName);
    const blob = await fetchBlob(`/api/v1/tool-sessions/${toolSessionId}/file?download=true&_=${Date.now()}`, {
      method: "GET",
      headers: createAuthorizedHeaders()
    });
    await saveBlobToDevice(blob, fileName);
    return fileName;
  }

  async function downloadBlobToDevice(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const linkElement = document.createElement("a");
    linkElement.href = blobUrl;
    linkElement.download = fileName;
    linkElement.rel = "noopener";
    document.body.appendChild(linkElement);
    linkElement.click();
    linkElement.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  }

  async function downloadToolSessionPdfToDevice(toolSessionId, title, fallbackFileName) {
    const fileName = buildPdfSaveFileName(title, fallbackFileName);
    const blob = await fetchBlob(`/api/v1/tool-sessions/${toolSessionId}/file?download=true&_=${Date.now()}`, {
      method: "GET",
      headers: createAuthorizedHeaders()
    });
    await downloadBlobToDevice(blob, fileName);
    return fileName;
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
    const menuMarkup = buildAppGridMenuMarkup();

    authActionsElements.forEach(function (element) {
      if (session) {
        const subscriptionCopy = session.subscriptionTier ? ` · ${session.subscriptionTier}` : "";
        element.innerHTML = `
          <div class="auth-actions-group">
            <span class="auth-chip">${escapeHtml((session.displayName || session.emailAddress) + subscriptionCopy)}</span>
            <button class="secondary-button" type="button" data-logout-button>Logout</button>
            ${menuMarkup}
          </div>
        `;
        return;
      }

      element.innerHTML = `
        <div class="auth-actions-group">
          <a class="secondary-button" href="${createReturnUrl("/login")}">Login</a>
          <a class="primary-button" href="${createReturnUrl("/signup")}">Sign up</a>
          ${menuMarkup}
        </div>
      `;
    });

    document.querySelectorAll("[data-logout-button]").forEach(function (button) {
      button.addEventListener("click", function () {
        clearSession();
        window.location.reload();
      });
    });

    bindAppGridMenus();
  }

  function buildAppGridMenuMarkup() {
    return `
      <div class="app-grid-menu" data-grid-menu>
        <button class="app-grid-button" type="button" data-grid-menu-toggle aria-expanded="false" aria-label="Open product menu">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="5" r="1.6"></circle>
            <circle cx="12" cy="5" r="1.6"></circle>
            <circle cx="19" cy="5" r="1.6"></circle>
            <circle cx="5" cy="12" r="1.6"></circle>
            <circle cx="12" cy="12" r="1.6"></circle>
            <circle cx="19" cy="12" r="1.6"></circle>
            <circle cx="5" cy="19" r="1.6"></circle>
            <circle cx="12" cy="19" r="1.6"></circle>
            <circle cx="19" cy="19" r="1.6"></circle>
          </svg>
        </button>
        <div class="app-grid-panel" data-grid-menu-panel hidden>
          <div class="app-grid-layout">
            <div class="app-grid-column">
              <span class="app-grid-heading">Other products</span>
              <div class="app-grid-list">
                <a class="app-grid-item" href="/all-tools#convert-tools">
                  <span class="menu-icon-badge menu-icon-badge--violet">IMG</span>
                  <span class="app-grid-copy">
                    <strong>PdfEditor IMG</strong>
                    <span>Polished image conversion and export workflows.</span>
                  </span>
                </a>
                <a class="app-grid-item" href="/unlock">
                  <span class="menu-icon-badge menu-icon-badge--blue">SIG</span>
                  <span class="app-grid-copy">
                    <strong>Unlock PDF</strong>
                    <span>Remove password protection in a dedicated security workspace.</span>
                  </span>
                </a>
                <a class="app-grid-item" href="/all-tools">
                  <span class="menu-icon-badge menu-icon-badge--teal">API</span>
                  <span class="app-grid-copy">
                    <strong>PdfEditor API</strong>
                    <span>Document automation for teams and developers.</span>
                  </span>
                </a>
                <article class="app-grid-promo">
                  <span class="menu-icon-badge menu-icon-badge--neutral">INT</span>
                  <span class="app-grid-copy">
                    <strong>Integrations</strong>
                    <span>Zapier, Make, storage connectors, and workflow hooks.</span>
                  </span>
                </article>
              </div>
            </div>
            <div class="app-grid-column">
              <span class="app-grid-heading">Solutions</span>
              <a class="app-grid-solution" href="/all-tools">
                <span class="menu-stack-badge">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                <span class="app-grid-copy">
                  <strong>Business</strong>
                  <span>Streamlined PDF editing and workflow tools for operations teams.</span>
                </span>
              </a>
              <span class="app-grid-heading app-grid-heading--spaced">Applications</span>
              <div class="app-grid-list">
                <article class="app-grid-item">
                  <span class="menu-icon-badge menu-icon-badge--coral">DESK</span>
                  <span class="app-grid-copy">
                    <strong>Desktop App</strong>
                    <span>Offline tooling for larger local document batches.</span>
                  </span>
                </article>
                <article class="app-grid-item">
                  <span class="menu-icon-badge menu-icon-badge--rose">MOB</span>
                  <span class="app-grid-copy">
                    <strong>Mobile App</strong>
                    <span>Quick review, signing, and upload flows on the go.</span>
                  </span>
                </article>
              </div>
            </div>
            <div class="app-grid-column app-grid-column--links">
              <div class="app-grid-link-list">
                <a href="/all-tools">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M12 2l2.8 5.7L21 8.6l-4.5 4.4 1.1 6.2L12 16.3 6.4 19.2 7.5 13 3 8.6l6.2-.9L12 2z"></path></svg>
                  </span>
                  Pricing
                </a>
                <a href="/edit">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M6 11V8a6 6 0 0 1 12 0v3"></path><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M12 15v2"></path></svg>
                  </span>
                  Security
                </a>
                <a href="/#features">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 5h6v6H5z"></path><path d="M13 5h6v6h-6z"></path><path d="M5 13h6v6H5z"></path><path d="M13 16h6"></path><path d="M16 13v6"></path></svg>
                  </span>
                  Features
                </a>
                <a href="/#about">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M20 8.5C20 6 18 4 15.5 4c-1.7 0-3 1-3.5 2.1C11.5 5 10.2 4 8.5 4 6 4 4 6 4 8.5c0 5.5 8 10.5 8 10.5S20 14 20 8.5z"></path></svg>
                  </span>
                  About us
                </a>
              </div>
              <div class="app-grid-divider"></div>
              <div class="app-grid-link-list">
                <a href="/#help">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M9.1 9a3 3 0 1 1 5.8 1c-.5 1.1-1.9 1.7-2.6 2.5-.5.5-.8 1-.8 2"></path><path d="M12 18h.01"></path><circle cx="12" cy="12" r="9"></circle></svg>
                  </span>
                  Help
                </a>
                <a href="/#help">
                  <span class="app-grid-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 12h18"></path><path d="M12 3a15 15 0 0 1 0 18"></path><path d="M12 3a15 15 0 0 0 0 18"></path><circle cx="12" cy="12" r="9"></circle></svg>
                  </span>
                  Language
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindAppGridMenus() {
    document.querySelectorAll("[data-grid-menu]").forEach(function (menu) {
      if (menu.dataset.bound === "true") {
        return;
      }

      menu.dataset.bound = "true";
      const toggle = menu.querySelector("[data-grid-menu-toggle]");
      const panel = menu.querySelector("[data-grid-menu-panel]");

      if (!toggle || !panel) {
        return;
      }

      toggle.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();

        const shouldOpen = !menu.classList.contains("app-grid-menu--open");
        closeAppGridMenus();

        if (shouldOpen) {
          menu.classList.add("app-grid-menu--open");
          toggle.setAttribute("aria-expanded", "true");
          panel.hidden = false;
        }
      });

      panel.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    });

    if (appGridMenuEventsBound) {
      return;
    }

    appGridMenuEventsBound = true;

    document.addEventListener("click", function () {
      closeAppGridMenus();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeAppGridMenus();
      }
    });
  }

  function closeAppGridMenus() {
    document.querySelectorAll("[data-grid-menu].app-grid-menu--open").forEach(function (menu) {
      menu.classList.remove("app-grid-menu--open");
      const toggle = menu.querySelector("[data-grid-menu-toggle]");
      const panel = menu.querySelector("[data-grid-menu-panel]");

      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
      }

      if (panel) {
        panel.hidden = true;
      }
    });
  }

  function highlightActiveNavigation() {
    const pageKey = document.body.dataset.page;
    document.querySelectorAll("[data-nav-link]").forEach(function (link) {
      if (link.dataset.navLink === pageKey) {
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
      return "Please keep each PDF under 25 MB for this app.";
    }

    return "";
  }

  function validatePdfFiles(files, minimumCount) {
    if (!files.length || files.length < minimumCount) {
      return `Please choose at least ${minimumCount} PDF files.`;
    }

    for (const file of files) {
      const validationMessage = validatePdfFile(file);
      if (validationMessage) {
        return validationMessage;
      }
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
    const isApiEnvelope = isJson &&
      payload &&
      typeof payload === "object" &&
      Object.prototype.hasOwnProperty.call(payload, "success") &&
      Object.prototype.hasOwnProperty.call(payload, "message");

    if (!response.ok) {
      if (isApiEnvelope) {
        throw new Error(payload.message || "Request failed.");
      }

      if (isJson && payload && typeof payload === "object") {
        throw new Error(payload.message || payload.title || payload.detail || "Request failed.");
      }

      throw new Error(typeof payload === "string" && payload ? payload : "Request failed.");
    }

    if (isApiEnvelope) {
      if (!payload.success) {
        throw new Error(payload.message || "Request failed.");
      }

      return payload.data;
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
    return TOOL_SESSION_STORAGE_KEYS[tool] || TOOL_SESSION_STORAGE_KEYS.edit;
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

  function initializeEditorAnnotations(statusElement, operationStatusElement) {
    const toolGroup = document.getElementById("editor-annotation-tool-group");
    const saveButton = document.getElementById("save-editor-annotations");
    const deleteButton = document.getElementById("delete-selected-annotation");
    const textInput = document.getElementById("annotation-text-value");
    const colorInput = document.getElementById("annotation-color-value");
    const strokeInput = document.getElementById("annotation-stroke-width");

    editorAnnotationState.statusElement = document.getElementById("annotation-status");
    editorAnnotationState.mainStatusElement = statusElement;
    editorAnnotationState.operationStatusElement = operationStatusElement;

    if (!toolGroup || toolGroup.dataset.bound === "true") {
      return;
    }

    toolGroup.dataset.bound = "true";

    toolGroup.addEventListener("click", function (event) {
      const button = event.target.closest("[data-editor-tool]");
      if (!button) {
        return;
      }

      setActiveEditorAnnotationTool(button.dataset.editorTool || "select");
    });

    saveButton.addEventListener("click", async function () {
      try {
        await flushPendingEditorAnnotationSave();
        setStatus(editorAnnotationState.statusElement, "Annotation state is up to date.", false);
      } catch (error) {
        setStatus(editorAnnotationState.statusElement, error.message, true);
      }
    });

    deleteButton.addEventListener("click", function () {
      if (!editorAnnotationState.selectedAnnotationId) {
        setStatus(editorAnnotationState.statusElement, "Select an annotation before deleting it.", true);
        return;
      }

      editorAnnotationState.annotations = editorAnnotationState.annotations.filter(function (annotation) {
        return annotation.toolSessionAnnotationId !== editorAnnotationState.selectedAnnotationId;
      });
      editorAnnotationState.selectedAnnotationId = "";
      renderDetectedTextBlocks();
      renderEditorAnnotations();
      scheduleEditorAnnotationSave();
      setStatus(editorAnnotationState.statusElement, "Selected annotation removed.", false);
    });

    textInput.addEventListener("input", function () {
      const selectedAnnotation = getSelectedEditorAnnotation();
      if (!selectedAnnotation || selectedAnnotation.annotationType !== "Text") {
        return;
      }

      selectedAnnotation.payload.text = textInput.value.trim() || "Text";
      renderEditorAnnotations();
      scheduleEditorAnnotationSave();
    });

    colorInput.addEventListener("input", function () {
      const selectedAnnotation = getSelectedEditorAnnotation();
      if (!selectedAnnotation) {
        return;
      }

      selectedAnnotation.payload.color = colorInput.value;
      renderEditorAnnotations();
      scheduleEditorAnnotationSave();
    });

    strokeInput.addEventListener("input", function () {
      const selectedAnnotation = getSelectedEditorAnnotation();
      if (!selectedAnnotation) {
        return;
      }

      const strokeWidth = getEditorStrokeWidth();
      if (selectedAnnotation.annotationType === "Text") {
        selectedAnnotation.payload.fontSize = 12 + strokeWidth * 2;
      } else {
        selectedAnnotation.payload.strokeWidth = strokeWidth;
      }

      renderEditorAnnotations();
      scheduleEditorAnnotationSave();
    });

    window.addEventListener("pointermove", handleEditorAnnotationPointerMove);
    window.addEventListener("pointerup", handleEditorAnnotationPointerUp);
    window.addEventListener("pointercancel", handleEditorAnnotationPointerUp);

    updateEditorAnnotationControls();
  }

  function hydrateEditorAnnotations(sessionAnnotations) {
    const previouslySelectedAnnotationId = editorAnnotationState.selectedAnnotationId;
    editorAnnotationState.annotations = normalizeEditorAnnotations(sessionAnnotations);
    editorAnnotationState.lastSavedSnapshot = buildEditorAnnotationSnapshot(editorAnnotationState.annotations);
    editorAnnotationState.pendingInteraction = null;
    editorAnnotationState.selectedAnnotationId = editorAnnotationState.annotations.some(function (annotation) {
      return annotation.toolSessionAnnotationId === previouslySelectedAnnotationId;
    })
      ? previouslySelectedAnnotationId
      : "";
    updateEditorAnnotationControls();
  }

  function normalizeEditorAnnotations(sessionAnnotations) {
    return (sessionAnnotations || []).map(function (annotation) {
      let payload = {};

      try {
        payload = JSON.parse(annotation.annotationPayloadJson || "{}");
      } catch (_error) {
        payload = {};
      }

      return {
        toolSessionAnnotationId: annotation.toolSessionAnnotationId || createEditorAnnotationId(),
        annotationType: annotation.annotationType,
        pageNumber: annotation.pageNumber,
        payload: payload,
        updatedOnUtc: annotation.updatedOnUtc || new Date().toISOString()
      };
    });
  }

  function renderEditorAnnotations() {
    getEditPdfViewer()
      .then(function (viewer) {
        if (!viewer || !editorAnnotationState.viewerReady) {
          renderAnnotationList();
          return;
        }

        for (let pageNumber = 1; pageNumber <= viewer.getPageCount(); pageNumber += 1) {
          const overlay = viewer.getPageOverlayElement(pageNumber);
          if (!overlay) {
            continue;
          }

          bindEditorOverlay(overlay, pageNumber);
          overlay.classList.toggle("editor-annotation-layer--drawing", editorAnnotationState.activeTool !== "select");
          overlay.innerHTML = "";
        }

        editorAnnotationState.annotations.forEach(function (annotation) {
          const overlay = viewer.getPageOverlayElement(annotation.pageNumber);
          if (!overlay) {
            return;
          }

          overlay.appendChild(buildEditorAnnotationElement(annotation, false));
        });

        const draftAnnotation = buildDraftEditorAnnotation();
        if (draftAnnotation) {
          const overlay = viewer.getPageOverlayElement(draftAnnotation.pageNumber);
          if (overlay) {
            overlay.appendChild(buildEditorAnnotationElement(draftAnnotation, true));
          }
        }

        renderAnnotationList();
        renderAttachmentObjectList();
        updateEditorAnnotationControls();
      })
      .catch(function () {
      });
  }

  function bindEditorOverlay(overlay, pageNumber) {
    if (overlay.dataset.bound === "true") {
      return;
    }

    overlay.dataset.bound = "true";
    overlay.addEventListener("pointerdown", function (event) {
      handleEditorAnnotationPointerDown(event, pageNumber, overlay);
    });
  }

  function handleEditorAnnotationPointerDown(event, pageNumber, overlay) {
    closeEditorContextMenu();

    if (!currentEditSession) {
      return;
    }

    const activeTool = editorAnnotationState.activeTool;
    const annotationElement = event.target.closest("[data-annotation-id]");
    const point = getNormalizedPoint(event, overlay.getBoundingClientRect());
    setEditorPlacementAnchor(pageNumber, point);

    if (activeTool === "select") {
      if (annotationElement) {
        const annotationId = annotationElement.dataset.annotationId;
        const annotation = findEditorAnnotation(annotationId);
        if (!annotation) {
          return;
        }

        const annotationHandleElement = event.target.closest("[data-annotation-handle]");

        event.preventDefault();
        if (typeof annotationElement.setPointerCapture === "function") {
          annotationElement.setPointerCapture(event.pointerId);
        }

        editorAnnotationState.selectedAnnotationId = annotationId;
        editorTextState.selectedTextBlockId = "";
        editorAnnotationState.pendingInteraction = annotationHandleElement && canResizeEditorAnnotation(annotation)
          ? {
            activeElement: annotationElement,
            bounds: overlay.getBoundingClientRect(),
            handleName: annotationHandleElement.dataset.annotationHandle || "bottom-right",
            kind: "resize-attachment",
            originalAnnotation: cloneEditorAnnotation(annotation),
            pointerId: event.pointerId,
            startPoint: point
          }
          : {
            activeElement: annotationElement,
            bounds: overlay.getBoundingClientRect(),
            kind: "move",
            originalAnnotation: cloneEditorAnnotation(annotation),
            startPoint: point,
            pointerId: event.pointerId
          };
        renderDetectedTextBlocks();
        renderEditorAnnotations();
      } else {
        editorAnnotationState.selectedAnnotationId = "";
        renderEditorAnnotations();
      }

      return;
    }

    event.preventDefault();

    if (activeTool === "text") {
      editorTextState.selectedTextBlockId = "";
      createTextAnnotation(pageNumber, point);
      return;
    }

    if (activeTool === "highlight" || activeTool === "rectangle") {
      if (typeof overlay.setPointerCapture === "function") {
        overlay.setPointerCapture(event.pointerId);
      }

      editorTextState.selectedTextBlockId = "";
      editorAnnotationState.pendingInteraction = {
        activeElement: overlay,
        annotationType: activeTool === "highlight" ? "Highlight" : "Rectangle",
        bounds: overlay.getBoundingClientRect(),
        currentPoint: point,
        kind: "shape",
        pageNumber: pageNumber,
        pointerId: event.pointerId,
        startPoint: point
      };
      renderDetectedTextBlocks();
      renderEditorAnnotations();
      return;
    }

    if (activeTool === "draw") {
      if (typeof overlay.setPointerCapture === "function") {
        overlay.setPointerCapture(event.pointerId);
      }

      editorTextState.selectedTextBlockId = "";
      editorAnnotationState.pendingInteraction = {
        activeElement: overlay,
        bounds: overlay.getBoundingClientRect(),
        kind: "freehand",
        pageNumber: pageNumber,
        pointerId: event.pointerId,
        points: [point, point]
      };
      renderDetectedTextBlocks();
      renderEditorAnnotations();
    }
  }

  function handleEditorAnnotationPointerMove(event) {
    const interaction = editorAnnotationState.pendingInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = getNormalizedPoint(event, interaction.bounds);

    if (interaction.kind === "move") {
      const deltaX = point.x - interaction.startPoint.x;
      const deltaY = point.y - interaction.startPoint.y;
      updateEditorAnnotation(applyEditorAnnotationOffset(interaction.originalAnnotation, deltaX, deltaY));
      renderEditorAnnotations();
      return;
    }

    if (interaction.kind === "resize-attachment") {
      updateEditorAnnotation(
        applyEditorAnnotationResize(interaction.originalAnnotation, interaction.handleName, point)
      );
      renderEditorAnnotations();
      return;
    }

    if (interaction.kind === "shape") {
      interaction.currentPoint = point;
      renderEditorAnnotations();
      return;
    }

    if (interaction.kind === "freehand") {
      const previousPoint = interaction.points[interaction.points.length - 1];
      if (!previousPoint || Math.hypot(previousPoint.x - point.x, previousPoint.y - point.y) > 0.002) {
        interaction.points.push(point);
        renderEditorAnnotations();
      }
    }
  }

  function handleEditorAnnotationPointerUp(event) {
    const interaction = editorAnnotationState.pendingInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (interaction.activeElement && typeof interaction.activeElement.releasePointerCapture === "function") {
      try {
        interaction.activeElement.releasePointerCapture(event.pointerId);
      } catch (_error) {
      }
    }

    if (interaction.kind === "move") {
      editorAnnotationState.pendingInteraction = null;
      scheduleEditorAnnotationSave();
      return;
    }

    if (interaction.kind === "resize-attachment") {
      editorAnnotationState.pendingInteraction = null;
      scheduleEditorAnnotationSave();
      return;
    }

    if (interaction.kind === "shape") {
      const payload = buildShapeAnnotationPayload(interaction.startPoint, interaction.currentPoint, interaction.annotationType);
      editorAnnotationState.pendingInteraction = null;

      if (!payload) {
        renderEditorAnnotations();
        return;
      }

      upsertEditorAnnotation({
        toolSessionAnnotationId: createEditorAnnotationId(),
        annotationType: interaction.annotationType,
        pageNumber: interaction.pageNumber,
        payload: payload,
        updatedOnUtc: new Date().toISOString()
      });
      scheduleEditorAnnotationSave();
      return;
    }

    if (interaction.kind === "freehand") {
      const payload = buildFreehandAnnotationPayload(interaction.points);
      editorAnnotationState.pendingInteraction = null;

      if (!payload) {
        renderEditorAnnotations();
        return;
      }

      upsertEditorAnnotation({
        toolSessionAnnotationId: createEditorAnnotationId(),
        annotationType: "Freehand",
        pageNumber: interaction.pageNumber,
        payload: payload,
        updatedOnUtc: new Date().toISOString()
      });
      scheduleEditorAnnotationSave();
    }
  }

  function createTextAnnotation(pageNumber, point) {
    const textValue = (document.getElementById("annotation-text-value").value || "").trim() || "Text";
    upsertEditorAnnotation({
      toolSessionAnnotationId: createEditorAnnotationId(),
      annotationType: "Text",
      pageNumber: pageNumber,
      payload: {
        color: getEditorAnnotationColor(),
        fontSize: 12 + getEditorStrokeWidth() * 2,
        height: 0.07,
        text: textValue,
        width: 0.24,
        x: clamp(point.x, 0.02, 0.9),
        y: clamp(point.y, 0.02, 0.92)
      },
      updatedOnUtc: new Date().toISOString()
    });
    scheduleEditorAnnotationSave();
  }

  function upsertEditorAnnotation(annotation) {
    editorAnnotationState.selectedAnnotationId = annotation.toolSessionAnnotationId;
    editorTextState.selectedTextBlockId = "";
    clearViewerTextSelection();
    updateEditorAnnotation(annotation);
    renderDetectedTextBlocks();
    renderEditorAnnotations();
    setStatus(editorAnnotationState.statusElement, `${annotation.annotationType} annotation updated in the editor.`, false);
  }

  function updateEditorAnnotation(annotation) {
    const nextAnnotations = editorAnnotationState.annotations.filter(function (existingAnnotation) {
      return existingAnnotation.toolSessionAnnotationId !== annotation.toolSessionAnnotationId;
    });
    nextAnnotations.push(annotation);
    editorAnnotationState.annotations = nextAnnotations.sort(compareEditorAnnotations);
  }

  function buildEditorAnnotationElement(annotation, isDraft) {
    const element = document.createElement("div");
    const isSelected = editorAnnotationState.selectedAnnotationId === annotation.toolSessionAnnotationId;
    element.className = `editor-annotation editor-annotation--${annotation.annotationType.toLowerCase()}${isSelected ? " editor-annotation--selected" : ""}${editorAnnotationState.flashedAnnotationId === annotation.toolSessionAnnotationId ? " editor-annotation--flash" : ""}`;

    if (!isDraft) {
      element.dataset.annotationId = annotation.toolSessionAnnotationId;
    }

    if (annotation.annotationType === "Freehand") {
      applyFreehandAnnotationStyles(element, annotation.payload, isDraft);
      return element;
    }

    applyBoxPositionStyles(element, annotation.payload);
    element.style.zIndex = String(Number(annotation.payload.zIndex) || 1);

    if (annotation.annotationType === "Text") {
      element.textContent = annotation.payload.text || "Text";
      element.style.color = annotation.payload.color || "#1f2430";
      element.style.fontSize = `${Number(annotation.payload.fontSize) || 18}px`;
    } else if (annotation.annotationType === "Highlight") {
      element.style.background = annotation.payload.color || "#fff28a";
      element.style.opacity = String(annotation.payload.opacity || 0.42);
    } else if (annotation.annotationType === "Rectangle") {
      element.style.borderColor = annotation.payload.color || "#ff4f44";
      element.style.borderWidth = `${Number(annotation.payload.strokeWidth) || 3}px`;
    } else if (annotation.annotationType === "Image") {
      const imageElement = document.createElement("img");
      imageElement.className = "editor-annotation-image";
      imageElement.alt = annotation.payload.alt || "Attached image";
      imageElement.src = annotation.payload.src || "";
      element.appendChild(imageElement);
    } else if (annotation.annotationType === "Link") {
      element.classList.add("editor-annotation--link");
      element.textContent = annotation.payload.label || annotation.payload.url || "Link";
    }

    if (isDraft) {
      element.style.opacity = "0.7";
    }

    if (!isDraft && isSelected && canResizeEditorAnnotation(annotation)) {
      element.classList.add("editor-annotation--resizable");
      ["top-left", "top-right", "bottom-left", "bottom-right"].forEach(function (handleName) {
        element.appendChild(buildEditorAnnotationHandle(handleName));
      });
    }

    return element;
  }

  function setActiveEditorAnnotationTool(toolName) {
    closeEditorContextMenu();
    editorAnnotationState.activeTool = toolName || "select";
    if (editorAnnotationState.activeTool !== "select") {
      editorTextState.selectedTextBlockId = "";
    }

    updateEditorAnnotationControls();
    renderDetectedTextBlocks();
    renderEditorAnnotations();
  }

  function applyFreehandAnnotationStyles(element, payload, isDraft) {
    const bounds = getFreehandBounds(payload.points || [], Number(payload.strokeWidth) || getEditorStrokeWidth());
    element.style.left = `${bounds.x * 100}%`;
    element.style.top = `${bounds.y * 100}%`;
    element.style.width = `${bounds.width * 100}%`;
    element.style.height = `${bounds.height * 100}%`;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "editor-annotation-freehand-svg");
    svg.setAttribute("viewBox", "0 0 1000 1000");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("class", "editor-annotation-freehand-path");
    path.setAttribute("points", buildFreehandPointsAttribute(payload.points || [], bounds));
    path.setAttribute("stroke", payload.color || "#ff4f44");
    path.setAttribute("stroke-width", String((Number(payload.strokeWidth) || 3) * 8));

    if (isDraft) {
      path.setAttribute("opacity", "0.75");
    }

    svg.appendChild(path);
    element.appendChild(svg);
  }

  function applyBoxPositionStyles(element, payload) {
    element.style.left = `${(Number(payload.x) || 0) * 100}%`;
    element.style.top = `${(Number(payload.y) || 0) * 100}%`;
    element.style.width = `${Math.max(Number(payload.width) || 0.12, 0.03) * 100}%`;
    element.style.height = `${Math.max(Number(payload.height) || 0.05, 0.03) * 100}%`;
  }

  function buildDraftEditorAnnotation() {
    const interaction = editorAnnotationState.pendingInteraction;
    if (!interaction) {
      return null;
    }

    if (interaction.kind === "shape") {
      const payload = buildShapeAnnotationPayload(interaction.startPoint, interaction.currentPoint, interaction.annotationType);
      if (!payload) {
        return null;
      }

      return {
        toolSessionAnnotationId: "draft",
        annotationType: interaction.annotationType,
        pageNumber: interaction.pageNumber,
        payload: payload
      };
    }

    if (interaction.kind === "freehand") {
      const payload = buildFreehandAnnotationPayload(interaction.points);
      if (!payload) {
        return null;
      }

      return {
        toolSessionAnnotationId: "draft",
        annotationType: "Freehand",
        pageNumber: interaction.pageNumber,
        payload: payload
      };
    }

    return null;
  }

  function buildShapeAnnotationPayload(startPoint, currentPoint, annotationType) {
    const x = Math.min(startPoint.x, currentPoint.x);
    const y = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);

    if (width < 0.01 || height < 0.01) {
      return null;
    }

    if (annotationType === "Highlight") {
      return {
        color: getEditorAnnotationColor(),
        height: height,
        opacity: 0.42,
        width: width,
        x: x,
        y: y
      };
    }

    return {
      color: getEditorAnnotationColor(),
      height: height,
      strokeWidth: getEditorStrokeWidth(),
      width: width,
      x: x,
      y: y
    };
  }

  function buildFreehandAnnotationPayload(points) {
    if (!points || points.length < 2) {
      return null;
    }

    return {
      color: getEditorAnnotationColor(),
      points: points.map(function (point) {
        return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
      }),
      strokeWidth: getEditorStrokeWidth()
    };
  }

  function applyEditorAnnotationOffset(annotation, deltaX, deltaY) {
    const nextAnnotation = cloneEditorAnnotation(annotation);
    nextAnnotation.updatedOnUtc = new Date().toISOString();

    if (nextAnnotation.annotationType === "Freehand") {
      nextAnnotation.payload.points = (nextAnnotation.payload.points || []).map(function (point) {
        return {
          x: clamp(point.x + deltaX, 0, 1),
          y: clamp(point.y + deltaY, 0, 1)
        };
      });
      return nextAnnotation;
    }

    const width = Number(nextAnnotation.payload.width) || 0.12;
    const height = Number(nextAnnotation.payload.height) || 0.05;
    nextAnnotation.payload.x = clamp((Number(nextAnnotation.payload.x) || 0) + deltaX, 0, 1 - width);
    nextAnnotation.payload.y = clamp((Number(nextAnnotation.payload.y) || 0) + deltaY, 0, 1 - height);
    return nextAnnotation;
  }

  function applyEditorAnnotationResize(annotation, handleName, point) {
    const nextAnnotation = cloneEditorAnnotation(annotation);
    nextAnnotation.updatedOnUtc = new Date().toISOString();

    const originalX = clamp(Number(nextAnnotation.payload.x) || 0, 0, 1);
    const originalY = clamp(Number(nextAnnotation.payload.y) || 0, 0, 1);
    const originalWidth = Math.max(Number(nextAnnotation.payload.width) || 0.12, 0.03);
    const originalHeight = Math.max(Number(nextAnnotation.payload.height) || 0.05, 0.03);
    const minWidth = nextAnnotation.annotationType === "Image" ? 0.05 : 0.08;
    const minHeight = nextAnnotation.annotationType === "Image" ? 0.05 : 0.05;

    let left = originalX;
    let top = originalY;
    let right = clamp(originalX + originalWidth, 0, 1);
    let bottom = clamp(originalY + originalHeight, 0, 1);

    switch (handleName) {
      case "top-left":
        left = clamp(point.x, 0, right - minWidth);
        top = clamp(point.y, 0, bottom - minHeight);
        break;
      case "top-right":
        right = clamp(point.x, left + minWidth, 1);
        top = clamp(point.y, 0, bottom - minHeight);
        break;
      case "bottom-left":
        left = clamp(point.x, 0, right - minWidth);
        bottom = clamp(point.y, top + minHeight, 1);
        break;
      default:
        right = clamp(point.x, left + minWidth, 1);
        bottom = clamp(point.y, top + minHeight, 1);
        break;
    }

    nextAnnotation.payload.x = left;
    nextAnnotation.payload.y = top;
    nextAnnotation.payload.width = Math.max(right - left, minWidth);
    nextAnnotation.payload.height = Math.max(bottom - top, minHeight);
    return nextAnnotation;
  }

  function buildEditorAnnotationHandle(handleName) {
    const handleElement = document.createElement("button");
    handleElement.type = "button";
    handleElement.className = `editor-annotation-handle editor-annotation-handle--${handleName}`;
    handleElement.dataset.annotationHandle = handleName;
    handleElement.setAttribute("aria-label", `Resize object from ${handleName.replace("-", " ")}`);
    return handleElement;
  }

  function updateEditorAnnotationControls() {
    const reviewAnnotations = editorAnnotationState.annotations.filter(function (annotation) {
      return !isAttachmentAnnotation(annotation);
    });

    document.querySelectorAll("[data-editor-tool]").forEach(function (button) {
      button.classList.toggle("editor-tool-chip--active", button.dataset.editorTool === editorAnnotationState.activeTool);
    });

    const selectedCountElement = document.getElementById("annotation-selected-count");
    if (selectedCountElement) {
      selectedCountElement.textContent = String(reviewAnnotations.length);
    }

    const annotationListCountElement = document.getElementById("annotation-list-count");
    if (annotationListCountElement) {
      annotationListCountElement.textContent = String(reviewAnnotations.length);
    }

    const selectedAnnotation = getSelectedEditorAnnotation();
    const textInput = document.getElementById("annotation-text-value");
    const colorInput = document.getElementById("annotation-color-value");
    const strokeInput = document.getElementById("annotation-stroke-width");

    if (selectedAnnotation && selectedAnnotation.annotationType === "Text") {
      textInput.value = selectedAnnotation.payload.text || "Text";
    }

    if (selectedAnnotation && selectedAnnotation.payload.color) {
      colorInput.value = selectedAnnotation.payload.color;
    }

    if (selectedAnnotation) {
      if (selectedAnnotation.annotationType === "Text") {
        strokeInput.value = String(Math.max(Math.round(((Number(selectedAnnotation.payload.fontSize) || 18) - 12) / 2), 1));
      } else if (selectedAnnotation.payload.strokeWidth) {
        strokeInput.value = String(selectedAnnotation.payload.strokeWidth);
      }
    }
  }

  function scheduleEditorAnnotationSave() {
    window.clearTimeout(editorAnnotationState.saveTimer);
    editorAnnotationState.saveTimer = window.setTimeout(function () {
      void persistEditorAnnotations();
    }, 360);
  }

  async function flushPendingEditorAnnotationSave() {
    if (editorAnnotationState.saveTimer) {
      window.clearTimeout(editorAnnotationState.saveTimer);
      editorAnnotationState.saveTimer = 0;
      await persistEditorAnnotations();
      return;
    }

    await editorAnnotationState.pendingSavePromise;
  }

  async function persistEditorAnnotations() {
    if (!currentEditSession) {
      return;
    }

    const snapshot = buildEditorAnnotationSnapshot(editorAnnotationState.annotations);
    if (snapshot === editorAnnotationState.lastSavedSnapshot) {
      return;
    }

    const toolSessionId = getActiveToolSessionId("edit");
    if (!toolSessionId) {
      return;
    }

    editorAnnotationState.isPersisting = true;
    setStatus(editorAnnotationState.statusElement, "Saving annotation state...", false);

    const request = {
      annotations: editorAnnotationState.annotations.map(function (annotation) {
        return {
          annotationPayloadJson: JSON.stringify(annotation.payload),
          annotationType: annotation.annotationType,
          pageNumber: annotation.pageNumber,
          toolSessionAnnotationId: annotation.toolSessionAnnotationId
        };
      })
    };

    editorAnnotationState.pendingSavePromise = fetchJson(`/api/v1/tool-sessions/${toolSessionId}/annotations`, {
      method: "PUT",
      headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(request)
    }).then(function (session) {
      const previouslySelectedAnnotationId = editorAnnotationState.selectedAnnotationId;
      currentEditSession = { ...currentEditSession, ...session };
      hydrateEditorAnnotations(session.annotations || []);
      editorAnnotationState.selectedAnnotationId = editorAnnotationState.annotations.some(function (annotation) {
        return annotation.toolSessionAnnotationId === previouslySelectedAnnotationId;
      })
        ? previouslySelectedAnnotationId
        : "";
      editorAnnotationState.lastSavedSnapshot = buildEditorAnnotationSnapshot(editorAnnotationState.annotations);
      renderToolSessionSummary("edit-document-summary", currentEditSession);
      renderEditorAnnotations();
      setStatus(editorAnnotationState.statusElement, "Annotation state saved.", false);
    }).catch(function (error) {
      setStatus(editorAnnotationState.statusElement, error.message, true);
      throw error;
    }).finally(function () {
      editorAnnotationState.isPersisting = false;
    });

    await editorAnnotationState.pendingSavePromise;
  }

  async function applyDraggedPageOrder(orderedPageNumbers) {
    const toolSessionId = requireEditToolSession(editorAnnotationState.mainStatusElement);
    if (!toolSessionId) {
      return;
    }

    const reorderInput = document.getElementById("reorder-page-numbers");
    if (reorderInput) {
      reorderInput.value = orderedPageNumbers.join(",");
    }

    activateToolbarButton("organize");
    activateEditorPanel("organize");
    setStatus(editorAnnotationState.operationStatusElement, "Applying dragged page order...", false);

    try {
      await flushPendingEditorAnnotationSave();
      const session = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/reorder-pages`, {
        method: "POST",
        headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ orderedPageNumbers: orderedPageNumbers })
      });

      renderEditSession(session);
      setStatus(editorAnnotationState.operationStatusElement, "Pages reordered successfully.", false);
    } catch (error) {
      setStatus(editorAnnotationState.operationStatusElement, error.message, true);
    }
  }

  function findEditorAnnotation(annotationId) {
    return editorAnnotationState.annotations.find(function (annotation) {
      return annotation.toolSessionAnnotationId === annotationId;
    }) || null;
  }

  function getSelectedEditorAnnotation() {
    return findEditorAnnotation(editorAnnotationState.selectedAnnotationId);
  }

  function cloneEditorAnnotation(annotation) {
    return JSON.parse(JSON.stringify(annotation));
  }

  function createEditorAnnotationId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildEditorAnnotationSnapshot(annotations) {
    return JSON.stringify(
      annotations
        .map(function (annotation) {
          return {
            annotationType: annotation.annotationType,
            pageNumber: annotation.pageNumber,
            payload: annotation.payload,
            toolSessionAnnotationId: annotation.toolSessionAnnotationId
          };
        })
        .sort(compareEditorAnnotations)
    );
  }

  function compareEditorAnnotations(left, right) {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    return String(left.toolSessionAnnotationId).localeCompare(String(right.toolSessionAnnotationId));
  }

  function renderAnnotationList() {
    const listElement = document.getElementById("annotation-list");
    const reviewAnnotations = editorAnnotationState.annotations.filter(function (annotation) {
      return !isAttachmentAnnotation(annotation);
    });
    if (!listElement) {
      return;
    }

    if (!reviewAnnotations.length) {
      listElement.classList.add("empty-state");
      listElement.innerHTML = '<div class="editor-sidebar-empty">Add an annotation to see it listed here.</div>';
      return;
    }

    listElement.classList.remove("empty-state");
    listElement.innerHTML = reviewAnnotations.map(function (annotation, index) {
      return `
        <button
          class="editor-sidebar-item${editorAnnotationState.selectedAnnotationId === annotation.toolSessionAnnotationId ? " editor-sidebar-item--selected" : ""}"
          type="button"
          data-annotation-list-item="${annotation.toolSessionAnnotationId}">
          <span class="editor-sidebar-item-title">
            <span>${escapeHtml(annotation.annotationType)}</span>
            <span class="editor-sidebar-item-chip">#${index + 1}</span>
          </span>
          <span class="editor-sidebar-item-copy">${escapeHtml(getAnnotationPreviewText(annotation))}</span>
          <span class="editor-sidebar-item-meta">Page ${annotation.pageNumber}</span>
        </button>
      `;
    }).join("");

    listElement.querySelectorAll("[data-annotation-list-item]").forEach(function (button) {
      button.addEventListener("click", function () {
        const annotationId = button.dataset.annotationListItem;
        const annotation = findEditorAnnotation(annotationId);
        if (!annotation) {
          return;
        }

        editorAnnotationState.activeTool = "select";
        editorAnnotationState.selectedAnnotationId = annotation.toolSessionAnnotationId;
        editorTextState.selectedTextBlockId = "";
        flashEditorAnnotation(annotation.toolSessionAnnotationId);
        updateEditorAnnotationControls();
        renderDetectedTextBlocks();
        renderEditorAnnotations();

        getEditPdfViewer()
          .then(function (viewer) {
            viewer.focusPage(annotation.pageNumber);
          })
          .catch(function () {
          });
      });
    });
  }

  function flashEditorAnnotation(annotationId) {
    editorAnnotationState.flashedAnnotationId = annotationId;
    window.clearTimeout(editorAnnotationState.flashTimer);
    editorAnnotationState.flashTimer = window.setTimeout(function () {
      if (editorAnnotationState.flashedAnnotationId === annotationId) {
        editorAnnotationState.flashedAnnotationId = "";
        renderEditorAnnotations();
      }
    }, 1150);
  }

  function getAnnotationPreviewText(annotation) {
    if (annotation.annotationType === "Text") {
      return annotation.payload.text || "Text annotation";
    }

    if (annotation.annotationType === "Highlight") {
      return "Highlight area";
    }

    if (annotation.annotationType === "Rectangle") {
      return "Rectangle callout";
    }

    if (annotation.annotationType === "Freehand") {
      return `Freehand stroke with ${Math.max((annotation.payload.points || []).length - 1, 1)} points`;
    }

    if (annotation.annotationType === "Image") {
      return annotation.payload.alt || "Image object";
    }

    if (annotation.annotationType === "Link") {
      return annotation.payload.url || annotation.payload.label || "Link object";
    }

    return `${annotation.annotationType} annotation`;
  }

  function isAttachmentAnnotation(annotation) {
    return !!annotation && (annotation.annotationType === "Image" || annotation.annotationType === "Link");
  }

  function canResizeEditorAnnotation(annotation) {
    return isAttachmentAnnotation(annotation);
  }

  function getSelectedAttachmentObject() {
    const annotation = getSelectedEditorAnnotation();
    return isAttachmentAnnotation(annotation) ? annotation : null;
  }

  function renderAttachmentObjectList() {
    const listElement = document.getElementById("attachment-object-list");
    const countElement = document.getElementById("attachment-object-count");
    const attachmentObjects = editorAnnotationState.annotations.filter(isAttachmentAnnotation);

    if (countElement) {
      countElement.textContent = String(attachmentObjects.length);
    }

    if (!listElement) {
      return;
    }

    if (!attachmentObjects.length) {
      listElement.classList.add("empty-state");
      listElement.innerHTML = '<div class="editor-sidebar-empty">Add an image or link object to manage it here.</div>';
      return;
    }

    listElement.classList.remove("empty-state");
    listElement.innerHTML = attachmentObjects.map(function (annotation, index) {
      return `
        <button
          class="editor-sidebar-item${editorAnnotationState.selectedAnnotationId === annotation.toolSessionAnnotationId ? " editor-sidebar-item--selected" : ""}"
          type="button"
          data-attachment-object-id="${annotation.toolSessionAnnotationId}">
          <span class="editor-sidebar-item-title">
            <span>${escapeHtml(annotation.annotationType)}</span>
            <span class="editor-sidebar-item-chip">#${index + 1}</span>
          </span>
          <span class="editor-sidebar-item-copy">${escapeHtml(getAnnotationPreviewText(annotation))}</span>
          <span class="editor-sidebar-item-meta">Page ${annotation.pageNumber}</span>
        </button>
      `;
    }).join("");

    listElement.querySelectorAll("[data-attachment-object-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        const annotation = findEditorAnnotation(button.dataset.attachmentObjectId);
        if (!annotation) {
          return;
        }

        editorAnnotationState.activeTool = "select";
        editorAnnotationState.selectedAnnotationId = annotation.toolSessionAnnotationId;
        editorTextState.selectedTextBlockId = "";
        flashEditorAnnotation(annotation.toolSessionAnnotationId);
        renderDetectedTextBlocks();
        renderEditorAnnotations();
        renderAttachmentObjectList();
        getEditPdfViewer().then(function (viewer) {
          viewer.focusPage(annotation.pageNumber);
        }).catch(function () {
        });
      });
    });
  }

  function renderDocumentAttachmentList() {
    const listElement = document.getElementById("document-attachment-list");
    const countElement = document.getElementById("document-attachment-count");
    const attachments = Array.isArray(currentEditSession?.attachments) ? currentEditSession.attachments : [];

    if (countElement) {
      countElement.textContent = String(attachments.length);
    }

    if (!listElement) {
      return;
    }

    if (!attachments.length) {
      listElement.classList.add("empty-state");
      listElement.innerHTML = '<div class="editor-sidebar-empty">Add a file attachment to manage it here.</div>';
      return;
    }

    listElement.classList.remove("empty-state");
    listElement.innerHTML = attachments.map(function (attachment) {
      return `
        <article class="editor-sidebar-item editor-sidebar-item--stacked">
          <span class="editor-sidebar-item-title">
            <span>${escapeHtml(attachment.fileName)}</span>
            <span class="editor-sidebar-item-chip">${escapeHtml(attachment.attachmentType || "File")}</span>
          </span>
          <span class="editor-sidebar-item-copy">${escapeHtml(formatBytes(attachment.fileSizeInBytes || 0))} · ${escapeHtml(attachment.mimeType || "application/octet-stream")}</span>
          <span class="editor-sidebar-item-actions">
            <a class="editor-sidebar-inline-link" href="${escapeHtml(attachment.downloadUrl)}" download>Download</a>
            <button class="editor-sidebar-inline-button" type="button" data-attachment-action="remove" data-tool-session-attachment-id="${attachment.toolSessionAttachmentId}">Remove</button>
          </span>
        </article>
      `;
    }).join("");

    listElement.querySelectorAll("[data-attachment-action=\"remove\"]").forEach(function (button) {
      button.addEventListener("click", async function () {
        if (!currentEditSession?.toolSessionId) {
          return;
        }

        const attachmentStatusElement = document.getElementById("attachment-status");
        const operationStatusElement = document.getElementById("edit-operation-status");

        setStatus(attachmentStatusElement, "Removing the file attachment...", false);
        setStatus(operationStatusElement, "Removing the file attachment...", false);

        try {
          const updatedSession = await fetchJson(`/api/v1/tool-sessions/${currentEditSession.toolSessionId}/attachments/${button.dataset.toolSessionAttachmentId}`, {
            method: "DELETE"
          });

          renderEditSession(updatedSession, {
            panelName: "attachments",
            reloadDetectedText: false,
            reloadViewer: false,
            toolbarAction: "attachments"
          });
          setStatus(attachmentStatusElement, "File attachment removed.", false);
          setStatus(operationStatusElement, updatedSession.lastOperationSummary || "Removed the file attachment.", false);
        } catch (error) {
          setStatus(attachmentStatusElement, error.message, true);
          setStatus(operationStatusElement, error.message, true);
        }
      });
    });
  }

  function updateSelectedAttachmentObjectOrder(direction) {
    const selectedAttachment = getSelectedAttachmentObject();
    if (!selectedAttachment) {
      setStatus(document.getElementById("attachment-status"), "Select an image or link object before changing its order.", true);
      return;
    }

    const zIndexes = editorAnnotationState.annotations
      .filter(isAttachmentAnnotation)
      .map(function (annotation) { return Number(annotation.payload.zIndex) || 1; });

    const nextAnnotation = cloneEditorAnnotation(selectedAttachment);
    if (direction === "front") {
      nextAnnotation.payload.zIndex = (zIndexes.length ? Math.max.apply(null, zIndexes) : 1) + 1;
    } else {
      nextAnnotation.payload.zIndex = (zIndexes.length ? Math.min.apply(null, zIndexes) : 1) - 1;
    }

    upsertEditorAnnotation(nextAnnotation);
    scheduleEditorAnnotationSave();
    renderAttachmentObjectList();
    setStatus(document.getElementById("attachment-status"), direction === "front" ? "Moved the selected object forward." : "Moved the selected object backward.", false);
  }

  function getNormalizedPoint(event, bounds) {
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    };
  }

  function getEditorAnnotationColor() {
    return document.getElementById("annotation-color-value").value || "#ff4f44";
  }

  function getEditorStrokeWidth() {
    return Number(document.getElementById("annotation-stroke-width").value || 3);
  }

  function getFreehandBounds(points, strokeWidth) {
    if (!points || points.length === 0) {
      return { height: 0.02, width: 0.02, x: 0, y: 0 };
    }

    const xValues = points.map(function (point) { return point.x; });
    const yValues = points.map(function (point) { return point.y; });
    const minX = Math.min.apply(null, xValues);
    const maxX = Math.max.apply(null, xValues);
    const minY = Math.min.apply(null, yValues);
    const maxY = Math.max.apply(null, yValues);
    const padding = Math.max((Number(strokeWidth) || 3) * 0.004, 0.006);
    return {
      x: clamp(minX - padding, 0, 1),
      y: clamp(minY - padding, 0, 1),
      width: Math.max(Math.min(maxX + padding, 1) - clamp(minX - padding, 0, 1), 0.012),
      height: Math.max(Math.min(maxY + padding, 1) - clamp(minY - padding, 0, 1), 0.012)
    };
  }

  function buildFreehandPointsAttribute(points, bounds) {
    return (points || []).map(function (point) {
      return `${(((point.x - bounds.x) / bounds.width) * 1000).toFixed(2)},${(((point.y - bounds.y) / bounds.height) * 1000).toFixed(2)}`;
    }).join(" ");
  }

  function initializeEditorTextEditing(statusElement, operationStatusElement) {
    const searchInput = document.getElementById("detected-text-search");
    const textValueInput = document.getElementById("detected-text-value");
    const fontNameInput = document.getElementById("detected-text-font-name");
    const fontOptionsElement = document.getElementById("detected-text-font-options");
    const fontSizeInput = document.getElementById("detected-text-font-size");
    const colorInput = document.getElementById("detected-text-color");
    const boldButton = document.getElementById("detected-text-bold");
    const italicButton = document.getElementById("detected-text-italic");
    const refreshButton = document.getElementById("refresh-detected-text");
    const applyButton = document.getElementById("apply-text-change");
    const copyButton = document.getElementById("copy-selected-text");
    const pasteButton = document.getElementById("paste-duplicated-text");
    const runOcrButton = document.getElementById("run-editor-ocr");
    const ocrStatusElement = document.getElementById("ocr-status");

    editorTextState.statusElement = document.getElementById("detected-text-status");
    editorTextState.operationStatusElement = operationStatusElement;

    if (!searchInput || searchInput.dataset.bound === "true") {
      return;
    }

    searchInput.dataset.bound = "true";
    void loadInstalledFontCatalog(fontOptionsElement);

    searchInput.addEventListener("input", function () {
      editorTextState.searchQuery = searchInput.value.trim().toLowerCase();
      renderDetectedTextBlocks();
    });

    textValueInput.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !editorTextState.inlineEditorDirty) {
        event.preventDefault();
        void undoLastDetectedTextOperation(statusElement);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        applyButton.click();
      }
    });

    textValueInput.addEventListener("focus", function () {
      const selectedTextBlock = getSelectedDetectedTextBlock();
      if (!selectedTextBlock) {
        return;
      }

      syncDetectedTextDraftValue(textValueInput.value, "panel");
    });

    textValueInput.addEventListener("input", function () {
      const selectedTextBlock = getSelectedDetectedTextBlock();
      if (!selectedTextBlock) {
        return;
      }

      syncDetectedTextDraftValue(textValueInput.value, "panel");
    });

    [boldButton, italicButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        const isPressed = button.getAttribute("aria-pressed") === "true";
        setDetectedTextStyleButtonState(button, !isPressed);
        syncDetectedTextInlineEditorStyle();
      });
    });

    [fontNameInput, fontSizeInput, colorInput].forEach(function (input) {
      if (!input) {
        return;
      }

      input.addEventListener("input", function () {
        const selectedTextBlock = getSelectedDetectedTextBlock();
        if (!selectedTextBlock) {
          updateDetectedTextControls();
          return;
        }

        syncDetectedTextInlineEditorStyle();
      });
    });

    if (copyButton) {
      copyButton.addEventListener("click", function () {
        copySelectedDetectedTextBlock();
      });
    }

    if (pasteButton) {
      pasteButton.addEventListener("click", async function () {
        await pasteClipboardIntoEditor(statusElement);
      });
    }

    refreshButton.addEventListener("click", async function () {
      const toolSessionId = requireEditToolSession(statusElement);
      if (!toolSessionId) {
        return;
      }

      try {
        await loadDocumentSnapshot(toolSessionId, true);
      } catch (error) {
        setStatus(editorTextState.statusElement, error.message, true);
      }
    });

    if (runOcrButton) {
      runOcrButton.addEventListener("click", async function () {
        const toolSessionId = requireEditToolSession(statusElement);
        if (!toolSessionId) {
          return;
        }

        const ocrCapability = editorTextState.capabilities.find(function (capability) {
          return capability && capability.capabilityName === "ocr";
        });

        if (!ocrCapability || !ocrCapability.isAvailable) {
          const message = "OCR is not ready in the current document engine runtime.";
          setStatus(ocrStatusElement, message, true);
          setStatus(editorTextState.operationStatusElement, message, true);
          return;
        }

        const languageCode = (document.getElementById("ocr-language-code")?.value || "eng").trim() || "eng";
        const pageRange = (document.getElementById("ocr-page-range")?.value || "").trim();
        const deskew = !!document.getElementById("ocr-deskew")?.checked;
        const forceOcr = !!document.getElementById("ocr-force")?.checked;

        setStatus(ocrStatusElement, "Running OCR on the current PDF...", false);
        setStatus(editorTextState.operationStatusElement, "Running OCR on the current PDF...", false);

        try {
          await flushPendingEditorAnnotationSave();
          editorTextState.pendingSelection = null;
          clearViewerTextSelection();

          const updatedSession = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/ocr`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              languageCode: languageCode,
              pageRange: pageRange || null,
              deskew: deskew,
              forceOcr: forceOcr
            })
          });

          renderEditSession(updatedSession, {
            panelName: "edit",
            reloadViewer: true,
            toolbarAction: "edit"
          });

          const successMessage = updatedSession.lastOperationSummary || "OCR completed successfully.";
          setStatus(ocrStatusElement, successMessage, false);
          setStatus(editorTextState.statusElement, successMessage, false);
          setStatus(editorTextState.operationStatusElement, successMessage, false);
        } catch (error) {
          setStatus(ocrStatusElement, error.message, true);
          setStatus(editorTextState.operationStatusElement, error.message, true);
        }
      });
    }

    applyButton.addEventListener("click", async function () {
      try {
        await applyDetectedTextChange({
          statusElement,
          textValueInput
        });
      } catch (error) {
        editorTextState.pendingSelection = null;
        setStatus(editorTextState.statusElement, error.message, true);
        setStatus(editorTextState.operationStatusElement, error.message, true);
      }
    });

    if (document.body.dataset.detectedTextAutoApplyBound !== "true") {
      document.body.dataset.detectedTextAutoApplyBound = "true";
      document.addEventListener("pointerdown", function (event) {
        if (document.body.dataset.page !== "edit") {
          return;
        }

        if (!editorTextState.editingTextBlockId) {
          return;
        }

        if (event.button && event.button !== 0 && event.pointerType !== "touch") {
          return;
        }

        if (event.target instanceof Element && event.target.closest(".detected-text-inline-shell")) {
          return;
        }

        const nextSelectionId = event.target instanceof Element
          ? String(event.target.closest(".detected-text-block")?.dataset.textBlockId || "")
          : "";
        scheduleInlineDetectedTextAutoApply(editorTextState.editingTextBlockId, { nextSelectionId });
      }, true);
    }

    window.addEventListener("pointermove", handleDetectedTextPointerMove);
    window.addEventListener("pointerup", handleDetectedTextPointerUp);
    window.addEventListener("pointercancel", handleDetectedTextPointerUp);
    document.addEventListener("keydown", function (event) {
      if (document.body.dataset.page !== "edit") {
        return;
      }

      if (isEditableInputTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (getActiveToolSessionId("edit")) {
          event.preventDefault();
          void undoLastDetectedTextOperation(statusElement);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        if (getSelectedDetectedTextBlock() || getActiveViewerTextSelection()) {
          event.preventDefault();
          void copySelectedDetectedTextBlock();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        if (getActiveToolSessionId("edit")) {
          event.preventDefault();
          void pasteClipboardIntoEditor(statusElement);
        }
        return;
      }

      const selectedTextBlock = getSelectedDetectedTextBlock();
      if (!selectedTextBlock) {
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Enter" || event.key === "F2")) {
        event.preventDefault();
        openDetectedTextBlockInlineEditor(getDetectedTextSelectionId(selectedTextBlock), { selectAll: true });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void duplicateSelectedDetectedTextBlock(statusElement, selectedTextBlock);
        return;
      }

      if (!event.ctrlKey && !event.metaKey && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        void deleteSelectedDetectedTextBlock(statusElement, selectedTextBlock);
        return;
      }

      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const baseDelta = event.shiftKey ? 0.014 : 0.0045;
        const resizeDelta = event.shiftKey ? 0.018 : 0.006;
        const isResize = event.altKey;
        let deltaX = 0;
        let deltaY = 0;
        let deltaWidth = 0;
        let deltaHeight = 0;

        switch (event.key) {
          case "ArrowLeft":
            if (isResize) {
              deltaWidth = -resizeDelta;
            } else {
              deltaX = -baseDelta;
            }
            break;
          case "ArrowRight":
            if (isResize) {
              deltaWidth = resizeDelta;
            } else {
              deltaX = baseDelta;
            }
            break;
          case "ArrowUp":
            if (isResize) {
              deltaHeight = -resizeDelta;
            } else {
              deltaY = -baseDelta;
            }
            break;
          case "ArrowDown":
            if (isResize) {
              deltaHeight = resizeDelta;
            } else {
              deltaY = baseDelta;
            }
            break;
          default:
            return;
        }

        void transformSelectedDetectedTextBlock(statusElement, selectedTextBlock, {
          deltaHeight,
          deltaWidth,
          deltaX,
          deltaY,
          keepOriginal: false
        });
      }
    });

    document.addEventListener("paste", function (event) {
      if (document.body.dataset.page !== "edit") {
        return;
      }

      if (isEditableInputTarget(event.target) || !getActiveToolSessionId("edit")) {
        return;
      }

      event.preventDefault();
      void pasteClipboardIntoEditor(statusElement, event);
    });
  }

  async function loadInstalledFontCatalog(fontOptionsElement) {
    if (!fontOptionsElement) {
      return [];
    }

    if (editorTextState.installedFontNames.length) {
      populateInstalledFontOptions(fontOptionsElement, editorTextState.installedFontNames);
      return editorTextState.installedFontNames;
    }

    if (!editorTextState.installedFontNamesPromise) {
      editorTextState.installedFontNamesPromise = fetchJson("/api/v1/editor-resources/fonts", {
        method: "GET",
        headers: createAuthorizedHeaders()
      }).then(function (response) {
        const fontNames = Array.isArray(response?.fontNames)
          ? response.fontNames
            .map(function (fontName) { return String(fontName || "").trim(); })
            .filter(Boolean)
          : [];

        editorTextState.installedFontNames = Array.from(new Set(fontNames)).sort(function (left, right) {
          return left.localeCompare(right, undefined, { sensitivity: "base" });
        });
        populateInstalledFontOptions(fontOptionsElement, editorTextState.installedFontNames);
        return editorTextState.installedFontNames;
      }).catch(function () {
        editorTextState.installedFontNamesPromise = null;
        return [];
      });
    }

    const fontNames = await editorTextState.installedFontNamesPromise;
    populateInstalledFontOptions(fontOptionsElement, fontNames);
    return fontNames;
  }

  function populateInstalledFontOptions(fontOptionsElement, fontNames) {
    if (!fontOptionsElement) {
      return;
    }

    const nextFontNames = Array.isArray(fontNames) ? fontNames : [];
    fontOptionsElement.innerHTML = nextFontNames.map(function (fontName) {
      return `<option value="${escapeHtml(fontName)}"></option>`;
    }).join("");
  }

  function clearDetectedTextFontResourceCache() {
    editorTextState.exactFontFamilies.clear();
    editorTextState.exactFontLoadPromises.clear();
    editorTextState.fontFallbackWarningKeys.clear();
    editorTextState.fontLoadFailureKeys.clear();
    if (editorTextState.fontRerenderHandle) {
      window.cancelAnimationFrame(editorTextState.fontRerenderHandle);
      editorTextState.fontRerenderHandle = 0;
    }
  }

  function buildDetectedTextExactStyle(textBlock, fontLike) {
    const fontName = String(fontLike?.fontName || textBlock?.fontName || textBlock?.sourceFontName || "").trim();
    const normalizedFontName = fontName.toLowerCase();
    return {
      colorHex: normalizeDetectedTextColorHex(fontLike?.colorHex || textBlock?.colorHex || textBlock?.sourceColorHex || "#0f172a"),
      fontFamily: String(fontLike?.fontFamily || textBlock?.fontFamily || textBlock?.sourceFontFamily || "").trim(),
      fontName,
      fontPostScriptName: String(fontLike?.fontPostScriptName || textBlock?.fontPostScriptName || textBlock?.sourceFontPostScriptName || "").trim(),
      fontResolutionStatus: String(fontLike?.fontResolutionStatus || textBlock?.fontResolutionStatus || textBlock?.sourceFontResolutionStatus || "").trim(),
      fontResourceName: String(fontLike?.fontResourceName || textBlock?.fontResourceName || textBlock?.sourceFontResourceName || "").trim(),
      fontSize: Number(fontLike?.fontSize || textBlock?.fontSize || textBlock?.renderedFontSize || textBlock?.sourceFontSize || textBlock?.sourceRenderedFontSize || 12),
      fontSource: String(fontLike?.fontSource || textBlock?.fontSource || textBlock?.sourceFontSource || "").trim(),
      isBold: typeof fontLike?.isBold === "boolean"
        ? fontLike.isBold
        : typeof textBlock?.isBold === "boolean"
          ? textBlock.isBold
          : /(bold|black|semibold|demi)/.test(normalizedFontName),
      isItalic: typeof fontLike?.isItalic === "boolean"
        ? fontLike.isItalic
        : typeof textBlock?.isItalic === "boolean"
          ? textBlock.isItalic
          : /(italic|oblique)/.test(normalizedFontName),
      saveCapability: String(fontLike?.saveCapability || textBlock?.saveCapability || textBlock?.sourceSaveCapability || "").trim(),
      toUnicodeAvailable: typeof fontLike?.toUnicodeAvailable === "boolean"
        ? fontLike.toUnicodeAvailable
        : !!(textBlock?.toUnicodeAvailable || textBlock?.sourceToUnicodeAvailable),
      canEmbedForEditing: typeof fontLike?.canEmbedForEditing === "boolean"
        ? fontLike.canEmbedForEditing
        : typeof textBlock?.canEmbedForEditing === "boolean"
          ? textBlock.canEmbedForEditing
          : !!textBlock?.sourceCanEmbedForEditing,
      editCapability: String(fontLike?.editCapability || textBlock?.editCapability || textBlock?.sourceEditCapability || "").trim()
    };
  }

  function buildDetectedTextFontDescriptor(textBlock, fontLike) {
    return buildDetectedTextExactStyle(textBlock, fontLike);
  }

  function buildDetectedTextFontResourceKey(descriptor) {
    const toolSessionId = currentEditSession?.toolSessionId || getActiveToolSessionId("edit");
    if (!toolSessionId || !descriptor?.fontName) {
      return "";
    }

    return [
      toolSessionId,
      String(descriptor.fontResourceName || "").trim().toLowerCase(),
      String(descriptor.fontPostScriptName || "").trim().toLowerCase(),
      String(descriptor.fontFamily || "").trim().toLowerCase(),
      String(descriptor.fontName || "").trim().toLowerCase(),
      String(descriptor.fontSource || "").trim().toLowerCase(),
      descriptor.isBold ? "1" : "0",
      descriptor.isItalic ? "1" : "0"
    ].join("::");
  }

  function hashDetectedTextFontResourceKey(value) {
    let hashValue = 0;
    const normalizedValue = String(value || "");
    for (let index = 0; index < normalizedValue.length; index += 1) {
      hashValue = ((hashValue << 5) - hashValue) + normalizedValue.charCodeAt(index);
      hashValue |= 0;
    }

    return Math.abs(hashValue);
  }

  function scheduleDetectedTextFontRerender() {
    if (editorTextState.fontRerenderHandle) {
      return;
    }

    editorTextState.fontRerenderHandle = window.requestAnimationFrame(function () {
      editorTextState.fontRerenderHandle = 0;
      renderDetectedTextBlocks();
      syncDetectedTextInlineEditorStyle();
    });
  }

  function ensureDetectedTextFontResource(textBlock, fontLike) {
    if (!textBlock || !window.FontFace || !document.fonts) {
      return Promise.resolve("");
    }

    const descriptor = buildDetectedTextFontDescriptor(textBlock, fontLike);
    const fontResourceKey = buildDetectedTextFontResourceKey(descriptor);
    if (!fontResourceKey) {
      return Promise.resolve("");
    }

    const cachedFamily = editorTextState.exactFontFamilies.get(fontResourceKey);
    if (cachedFamily) {
      return Promise.resolve(cachedFamily);
    }

    if (editorTextState.fontLoadFailureKeys.has(fontResourceKey)) {
      return Promise.resolve("");
    }

    const pendingPromise = editorTextState.exactFontLoadPromises.get(fontResourceKey);
    if (pendingPromise) {
      return pendingPromise;
    }

    const toolSessionId = currentEditSession?.toolSessionId || getActiveToolSessionId("edit");
    const textObjectId = String(textBlock.textObjectId || "");
    const sourceTextBlockId = String(textBlock.sourceTextBlockId || textBlock.textBlockId || "");
    const query = new URLSearchParams({
      textObjectId: textObjectId,
      textBlockId: sourceTextBlockId,
      fontName: descriptor.fontName,
      isBold: descriptor.isBold ? "true" : "false",
      isItalic: descriptor.isItalic ? "true" : "false"
    });

    const nextPromise = fetchJson(`/api/v1/tool-sessions/${toolSessionId}/font-resource?${query.toString()}`, {
      method: "GET",
      headers: createAuthorizedHeaders()
    }).then(async function (response) {
      if (!response?.fontDataBase64) {
        throw new Error("The editor could not load the selected font resource.");
      }

      const familySeed = String(response.resolvedFontName || descriptor.fontName || "PdfEditorFont")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "") || "PdfEditorFont";
      const exactFamilyName = `PdfEditorExact_${familySeed}_${hashDetectedTextFontResourceKey(fontResourceKey)}`;
      const fontFace = new FontFace(
        exactFamilyName,
        `url(data:${response.contentType || "font/ttf"};base64,${response.fontDataBase64})`,
        {
          style: descriptor.isItalic ? "italic" : "normal",
          weight: descriptor.isBold ? "700" : "400"
        }
      );

      await fontFace.load();
      document.fonts.add(fontFace);
      editorTextState.exactFontFamilies.set(fontResourceKey, exactFamilyName);

      if (response.isFallback && response.warning && !editorTextState.fontFallbackWarningKeys.has(fontResourceKey)) {
        editorTextState.fontFallbackWarningKeys.add(fontResourceKey);
        setStatus(
          editorTextState.operationStatusElement || editorTextState.statusElement,
          response.warning,
          false
        );
      }

      scheduleDetectedTextFontRerender();
      return exactFamilyName;
    }).catch(function (error) {
      editorTextState.fontLoadFailureKeys.add(fontResourceKey);
      console.warn("Detected text font preview fallback", error);
      return "";
    }).finally(function () {
      editorTextState.exactFontLoadPromises.delete(fontResourceKey);
    });

    editorTextState.exactFontLoadPromises.set(fontResourceKey, nextPromise);
    return nextPromise;
  }

  function ensureDetectedTextFontResourcesForTextBlock(textBlock) {
    if (!textBlock) {
      return;
    }

    void ensureDetectedTextFontResource(textBlock, textBlock);
    const previewLines = Array.isArray(textBlock?.previewLines) && textBlock.previewLines.length
      ? textBlock.previewLines
      : Array.isArray(textBlock?.sourcePreviewLines) ? textBlock.sourcePreviewLines : [];

    previewLines.forEach(function (previewLine) {
      void ensureDetectedTextFontResource(textBlock, previewLine);
      const previewSpans = Array.isArray(previewLine?.spans) ? previewLine.spans : [];
      previewSpans.forEach(function (previewSpan) {
        void ensureDetectedTextFontResource(textBlock, previewSpan);
      });
    });
  }

  async function enqueueDetectedTextOperation(operation) {
    const previousPromise = editorTextState.pendingOperationPromise || Promise.resolve();
    const nextPromise = previousPromise
      .catch(function () {
      })
      .then(operation);

    editorTextState.pendingOperationPromise = nextPromise.then(
      function () { return undefined; },
      function () { return undefined; }
    );

    return nextPromise;
  }

  async function submitDetectedTextReplacement(statusElement, textBlock, selectedTextValue, replacementText, nextStyle) {
    const toolSessionId = requireEditToolSession(statusElement);
    if (!toolSessionId || !textBlock) {
      return;
    }

    return enqueueDetectedTextOperation(async function () {
      await flushPendingEditorAnnotationSave();

      const replacementTargetText = normalizeEditableTextValue(selectedTextValue);
      const editableBlockText = normalizeEditableTextValue(getEditableDetectedTextContent(textBlock));
      const replacementValue = normalizeEditableTextValue(replacementText);
      const updatedBlockText = replacementTargetText && replacementTargetText !== editableBlockText
        ? replaceFirstOccurrence(editableBlockText, replacementTargetText, replacementValue)
        : replacementValue;
      const stylePayload = buildDetectedTextStylePayload(textBlock, nextStyle);

      const response = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/replace-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...stylePayload,
          textObjectId: textBlock.textObjectId || "",
          replacementText: updatedBlockText,
          textBlockId: textBlock.textBlockId
        })
      });

      applyLocalTextOperationResponse(response);
      setStatus(editorTextState.statusElement, "PDF text updated successfully.", false);
      setStatus(editorTextState.operationStatusElement, response.session.lastOperationSummary || "Updated PDF text successfully.", false);
    });
  }

  async function duplicateSelectedDetectedTextBlock(statusElement, textBlock) {
    const offset = 0.026;
    return transformSelectedDetectedTextBlock(statusElement, textBlock, {
      deltaX: offset,
      deltaY: offset,
      keepOriginal: true
    });
  }

  async function undoLastDetectedTextOperation(statusElement) {
    const toolSessionId = requireEditToolSession(statusElement);
    if (!toolSessionId || editorTextState.textUndoInProgress) {
      return;
    }

    editorTextState.textUndoInProgress = true;
    setStatus(editorTextState.statusElement, "Undoing the last PDF text edit...", false);
    setStatus(editorTextState.operationStatusElement, "Restoring previous text state...", false);

    try {
      const response = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/undo-text`, {
        method: "POST"
      });
      const textBlocks = Array.isArray(response?.textBlocks) ? response.textBlocks : [];
      clearInlineDetectedTextEditState();
      clearViewerTextSelection();
      replaceLocalDetectedTextBlocks(textBlocks);
      activateEditorPanel("edit");
      activateToolbarButton("edit");
      setStatus(editorTextState.statusElement, "Last PDF text edit undone.", false);
      setStatus(editorTextState.operationStatusElement, "Restored the previous text state.", false);
    } catch (error) {
      const message = error?.message || "Unable to undo the last text edit.";
      setStatus(editorTextState.statusElement, message, true);
      setStatus(editorTextState.operationStatusElement, message, true);
    } finally {
      editorTextState.textUndoInProgress = false;
    }
  }

  async function deleteSelectedDetectedTextBlock(statusElement, textBlock) {
    const selectedTextValue = getSelectedEditableTextValue();
    if (!selectedTextValue) {
      setStatus(editorTextState.statusElement, "Select detected PDF text before deleting it.", true);
      return;
    }

    setStatus(editorTextState.statusElement, "Removing the selected PDF text...", false);
    setStatus(editorTextState.operationStatusElement, "Removing the selected PDF text...", false);
    return submitDetectedTextReplacement(statusElement, textBlock, selectedTextValue, "");
  }

  async function transformSelectedDetectedTextBlock(statusElement, textBlock, options) {
    if (!textBlock) {
      return;
    }

    const nextBounds = clampSourceBounds({
      x: textBlock.x + Number(options?.deltaX || 0),
      y: textBlock.y + Number(options?.deltaY || 0),
      width: textBlock.width + Number(options?.deltaWidth || 0),
      height: textBlock.height + Number(options?.deltaHeight || 0)
    });

    if (!nextBounds) {
      return;
    }

    return applyDetectedTextLayoutUpdate(textBlock, nextBounds, Boolean(options?.keepOriginal));
  }

  function initializeEditorContextMenu(statusElement, operationStatusElement) {
    const menu = document.getElementById("editor-context-menu");
    const menuBackdrop = document.getElementById("editor-context-menu-backdrop");
    const viewerCanvas = document.getElementById("edit-viewer-canvas");
    const scrollPanel = document.getElementById("edit-viewer-scroll");

    editorContextMenuState.statusElement = statusElement;
    editorContextMenuState.operationStatusElement = operationStatusElement;

    if (!menu || !viewerCanvas || viewerCanvas.dataset.contextMenuBound === "true") {
      return;
    }

    viewerCanvas.dataset.contextMenuBound = "true";

    if (menuBackdrop) {
      menuBackdrop.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        closeEditorContextMenu();
      });

      menuBackdrop.addEventListener("mousedown", function (event) {
        event.preventDefault();
        closeEditorContextMenu();
      });

      menuBackdrop.addEventListener("click", function (event) {
        event.preventDefault();
        closeEditorContextMenu();
      });

      menuBackdrop.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        closeEditorContextMenu();
      });
    }

    viewerCanvas.addEventListener("pointerdown", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    }, true);

    viewerCanvas.addEventListener("mousedown", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    }, true);

    viewerCanvas.addEventListener("click", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    }, true);

    viewerCanvas.addEventListener("wheel", function () {
      closeEditorContextMenu();
    }, { passive: true, capture: true });

    viewerCanvas.addEventListener("contextmenu", function (event) {
      const pageSurface = event.target.closest(".pdfjs-page-surface");
      if (!pageSurface) {
        closeEditorContextMenu();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const annotationElement = event.target.closest("[data-annotation-id]");
      const textElement = event.target.closest("[data-text-block-id]");
      const textLayerElement = event.target.closest(".pdfjs-text-layer");
      setEditorPlacementAnchorFromEvent(pageSurface, event);

      if (annotationElement) {
        const annotation = findEditorAnnotation(annotationElement.dataset.annotationId);
        if (annotation) {
          editorAnnotationState.activeTool = "select";
          editorAnnotationState.selectedAnnotationId = annotation.toolSessionAnnotationId;
          editorTextState.selectedTextBlockId = "";
          clearViewerTextSelection();
          renderDetectedTextBlocks();
          renderEditorAnnotations();
        }
      } else if (textElement) {
        selectDetectedTextBlock(textElement.dataset.textBlockId, false);
      } else if (textLayerElement) {
        const pageNumber = Number(pageSurface.closest("[data-page-number]")?.dataset.pageNumber || editorAnnotationState.activePageNumber || 1);
        const pointSelection = getViewerPointSelection(textLayerElement, event);
        const textBlock = pointSelection
          ? (resolveDetectedTextBlockFromNormalizedRect(pageNumber, pointSelection.bounds, pointSelection.text)
            || resolveDetectedTextBlockFromPoint(pageNumber, textLayerElement, event.clientX, event.clientY))
          : resolveDetectedTextBlockFromPoint(pageNumber, textLayerElement, event.clientX, event.clientY);
        if (textBlock) {
          selectDetectedTextBlock(getDetectedTextSelectionId(textBlock), false);
        }
      }

      openEditorContextMenu(event.clientX, event.clientY);
    });

    menu.addEventListener("click", async function (event) {
      const actionElement = event.target.closest("[data-context-action]");
      if (!actionElement || actionElement.disabled) {
        return;
      }

      event.preventDefault();
      closeEditorContextMenu();

      try {
        await handleEditorContextAction(actionElement.dataset.contextAction);
      } catch (error) {
        setStatus(editorContextMenuState.operationStatusElement, error.message || "The editor action could not be completed.", true);
      }
    });

    document.addEventListener("pointerdown", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    });

    document.addEventListener("mousedown", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    }, true);

    document.addEventListener("click", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu")) {
        closeEditorContextMenu();
      }
    }, true);

    document.addEventListener("contextmenu", function (event) {
      if (!menu.hidden && !event.target.closest("#editor-context-menu") && !event.target.closest("#edit-viewer-canvas")) {
        closeEditorContextMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeEditorContextMenu();
      }
    });

    if (scrollPanel) {
      scrollPanel.addEventListener("scroll", function () {
        closeEditorContextMenu();
      }, { passive: true });
    }

    document.addEventListener("scroll", function () {
      closeEditorContextMenu();
    }, true);

    window.addEventListener("resize", closeEditorContextMenu);
    window.addEventListener("blur", closeEditorContextMenu);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        closeEditorContextMenu();
      }
    });
  }

  function openEditorContextMenu(clientX, clientY) {
    const menu = document.getElementById("editor-context-menu");
    const menuBackdrop = document.getElementById("editor-context-menu-backdrop");
    if (!menu) {
      return;
    }

    updateEditorContextMenuActions(menu);

    menu.hidden = false;
    if (menuBackdrop) {
      menuBackdrop.hidden = false;
    }
    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - menuRect.width - 16, 12);
    const maxTop = Math.max(window.innerHeight - menuRect.height - 16, 12);
    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;
  }

  function closeEditorContextMenu() {
    const menu = document.getElementById("editor-context-menu");
    const menuBackdrop = document.getElementById("editor-context-menu-backdrop");
    if (!menu) {
      return;
    }

    menu.hidden = true;
    menu.style.left = "";
    menu.style.top = "";
    if (menuBackdrop) {
      menuBackdrop.hidden = true;
    }
  }

  function updateEditorContextMenuActions(menu) {
    const hasSession = !!getActiveToolSessionId("edit");
    const hasSelectedAnnotation = !!getSelectedEditorAnnotation();
    const hasSelectedTextBlock = !!getSelectedDetectedTextBlock();
    const hasViewerTextSelection = !!getActiveViewerTextSelection();
    const selectedAttachmentObject = getSelectedAttachmentObject();
    const downloadLink = document.getElementById("download-edited-file");
    const hasDownload = !!downloadLink && !downloadLink.classList.contains("disabled-link");

    menu.querySelectorAll("[data-context-action]").forEach(function (button) {
      const action = button.dataset.contextAction;
      button.disabled =
        (!hasSession && action !== "tool-select") ||
        (action === "delete-selected-annotation" && !hasSelectedAnnotation) ||
        (action === "focus-selected-text" && !hasSelectedTextBlock) ||
        (action === "copy-selected-text" && !hasSelectedTextBlock && !hasViewerTextSelection) ||
        ((action === "bring-object-forward" || action === "send-object-back") && !selectedAttachmentObject) ||
        (action === "download-pdf" && !hasDownload);
    });
  }

  async function handleEditorContextAction(action) {
    switch (action) {
      case "tool-select":
        setActiveEditorAnnotationTool("select");
        focusEditorCanvas();
        return;
      case "tool-text":
        setActiveEditorAnnotationTool("text");
        focusEditorCanvas();
        return;
      case "tool-highlight":
        setActiveEditorAnnotationTool("highlight");
        focusEditorCanvas();
        return;
      case "tool-rectangle":
        setActiveEditorAnnotationTool("rectangle");
        focusEditorCanvas();
        return;
      case "tool-draw":
        setActiveEditorAnnotationTool("draw");
        focusEditorCanvas();
        return;
      case "show-edit":
        activateToolbarButton("edit");
        activateEditorPanel("edit");
        return;
      case "show-organize":
        activateToolbarButton("organize");
        activateEditorPanel("organize");
        return;
      case "show-review":
        activateToolbarButton("review");
        activateEditorPanel("review");
        return;
      case "show-attachments":
        activateToolbarButton("attachments");
        activateEditorPanel("attachments");
        return;
      case "copy-selected-text":
        copySelectedDetectedTextBlock();
        return;
      case "paste-text-duplicate":
        await pasteClipboardIntoEditor(editorContextMenuState.statusElement);
        return;
      case "save-annotations":
        await flushPendingEditorAnnotationSave();
        setStatus(editorAnnotationState.statusElement, "Annotation state is up to date.", false);
        return;
      case "delete-selected-annotation":
        document.getElementById("delete-selected-annotation").click();
        return;
      case "refresh-detected-text":
        await loadDocumentSnapshot(requireEditToolSession(editorContextMenuState.statusElement), true);
        return;
      case "focus-selected-text": {
        activateToolbarButton("edit");
        activateEditorPanel("edit");
        const selectedTextBlock = getSelectedDetectedTextBlock();
        if (selectedTextBlock) {
          openDetectedTextBlockInlineEditor(getDetectedTextSelectionId(selectedTextBlock), { selectAll: true });
        }
        return;
      }
      case "bring-object-forward":
        updateSelectedAttachmentObjectOrder("front");
        return;
      case "send-object-back":
        updateSelectedAttachmentObjectOrder("back");
        return;
      case "save-document":
        document.getElementById("save-edited-document").click();
        return;
      case "download-pdf":
        document.getElementById("download-edited-file").click();
        return;
      default:
        return;
    }
  }

  async function loadDocumentSnapshot(toolSessionId, showLoadingStatus) {
    const loadSequence = ++editorTextState.loadSequence;

    if (showLoadingStatus) {
      setStatus(editorTextState.statusElement, "Loading the PDF editor snapshot...", false);
    }

    const response = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/document-snapshot`, {
      method: "GET",
      headers: createAuthorizedHeaders()
    });

    if (loadSequence !== editorTextState.loadSequence) {
      return;
    }

    const previouslySelectedTextBlockId = editorTextState.selectedTextBlockId;
    const previousFingerprint = editorTextState.documentFingerprintSha256;
    const nextFingerprint = String(response.documentFingerprintSha256 || "");
    const fingerprintChanged = !!previousFingerprint && !!nextFingerprint && previousFingerprint !== nextFingerprint;

    editorTextState.documentFingerprintSha256 = nextFingerprint;
    if (previousFingerprint !== nextFingerprint) {
      clearDetectedTextFontResourceCache();
      clearDetectedTextHitRegionCache();
    }

    if (fingerprintChanged) {
      editorTextState.preservedSourceFallbackWarningIds.clear();
    }
    editorTextState.pages = Array.isArray(response.pages) ? response.pages.slice() : [];
    editorTextState.capabilities = Array.isArray(response.capabilities) ? response.capabilities.slice() : [];
    clearDetectedTextHitRegionCache();
    editorTextState.detectedTextBlocks = (response.textBlocks || []).slice().sort(compareDetectedTextBlocks);

    if (fingerprintChanged && !editorTextState.pendingSelection) {
      clearViewerTextSelection();
    }

    editorTextState.selectedTextBlockId = resolveDetectedTextSelection(previouslySelectedTextBlockId);
    if (editorTextState.editingTextBlockId && editorTextState.editingTextBlockId !== editorTextState.selectedTextBlockId) {
      clearInlineDetectedTextEditState();
    }
    renderDetectedTextBlocks();

    if (showLoadingStatus) {
      const ocrCapability = editorTextState.capabilities.find(function (capability) {
        return capability && capability.capabilityName === "ocr";
      });

      if (editorTextState.detectedTextBlocks.length) {
        setStatus(editorTextState.statusElement, `Loaded ${editorTextState.detectedTextBlocks.length} editable text block${editorTextState.detectedTextBlocks.length === 1 ? "" : "s"} from the engine snapshot.`, false);
      } else {
        setStatus(
          editorTextState.statusElement,
          ocrCapability?.isAvailable
            ? "No editable text was detected in this PDF yet. Run OCR in the editor panel to turn scans into editable text."
            : "No editable text was detected in this PDF yet. OCR is not ready in the current engine runtime.",
          false);
      }
    }
  }

  function getDetectedTextSelectionId(textBlock) {
    if (!textBlock || typeof textBlock !== "object") {
      return "";
    }

    return String(textBlock.textObjectId || textBlock.textBlockId || "");
  }

  function renderDetectedTextBlocks() {
    renderDetectedTextList();

    getEditPdfViewer()
      .then(function (viewer) {
        if (!viewer || !editorAnnotationState.viewerReady) {
          updateDetectedTextControls();
          return;
        }

        for (let pageNumber = 1; pageNumber <= viewer.getPageCount(); pageNumber += 1) {
          const textLayer = viewer.getPageTextLayerElement(pageNumber);
          const detectedTextLayer = viewer.getPageDetectedTextLayerElement(pageNumber);
          const pageSurface = viewer.getPageSurfaceElement(pageNumber);

          if (!textLayer || !detectedTextLayer || !pageSurface) {
            continue;
          }

          bindEditorPageSurface(pageSurface);
          bindEditorTextLayer(textLayer, pageNumber);
          detectedTextLayer.innerHTML = "";

          const pageTextBlocks = editorTextState.detectedTextBlocks
            .filter(function (textBlock) { return textBlock.pageNumber === pageNumber; });

          pageTextBlocks
            .filter(function (textBlock) {
              return textBlock.isOverlayObject && textBlock.hideSourceOnCommit && textBlock.sourcePageNumber === pageNumber;
            })
            .forEach(function (textBlock) {
              detectedTextLayer.appendChild(buildDetectedTextSourceMaskElement(textBlock));
            });

          pageTextBlocks.forEach(function (textBlock) {
            detectedTextLayer.appendChild(buildDetectedTextBlockElement(textBlock, pageSurface));
          });
        }

        updateRenderedTextLayerHighlights(viewer);
        updateDetectedTextControls();
      })
      .catch(function () {
      });
  }

  function renderDetectedTextList() {
    const listElement = document.getElementById("detected-text-list");
    const countElement = document.getElementById("detected-text-count");

    if (countElement) {
      countElement.textContent = String(editorTextState.detectedTextBlocks.length);
    }

    if (!listElement) {
      return;
    }

    if (!editorTextState.detectedTextBlocks.length) {
      listElement.classList.add("empty-state");
      listElement.innerHTML = '<div class="editor-sidebar-empty">Load a PDF to scan the text that can be edited.</div>';
      return;
    }

    const filteredTextBlocks = getFilteredDetectedTextBlocks();
    if (!filteredTextBlocks.length) {
      listElement.classList.add("empty-state");
      listElement.innerHTML = '<div class="editor-sidebar-empty">No detected text matches this search yet.</div>';
      return;
    }

    listElement.classList.remove("empty-state");
    listElement.innerHTML = filteredTextBlocks.map(function (textBlock, index) {
      const selectionId = getDetectedTextSelectionId(textBlock);
      return `
        <button
          class="editor-sidebar-item editor-sidebar-item--text${editorTextState.selectedTextBlockId === selectionId ? " editor-sidebar-item--selected" : ""}"
          type="button"
          data-detected-text-item="${selectionId}">
          <span class="editor-sidebar-item-title">
            <span>${escapeHtml(buildDetectedTextHeading(textBlock))}</span>
            <span class="editor-sidebar-item-chip">#${index + 1}</span>
          </span>
          <span class="editor-sidebar-item-copy">${escapeHtml(textBlock.text)}</span>
          <span class="editor-sidebar-item-meta">Page ${textBlock.pageNumber}</span>
        </button>
      `;
    }).join("");

    listElement.querySelectorAll("[data-detected-text-item]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectDetectedTextBlock(button.dataset.detectedTextItem, true);
      });
    });
  }

  function bindEditorTextLayer(textLayer, pageNumber) {
    if (textLayer.dataset.selectionBound === "true") {
      return;
    }

    textLayer.dataset.selectionBound = "true";

    textLayer.addEventListener("pointerdown", function (event) {
      closeEditorContextMenu();
      if (editorAnnotationState.activeTool !== "select") {
        return;
      }

      const pageSurface = textLayer.closest(".pdfjs-page-surface");
      if (pageSurface) {
        setEditorPlacementAnchorFromEvent(pageSurface, event, pageNumber);
      }

      editorAnnotationState.selectedAnnotationId = "";
      renderEditorAnnotations();
    });

    textLayer.addEventListener("pointerup", function (event) {
      if (editorAnnotationState.activeTool !== "select") {
        return;
      }

      window.requestAnimationFrame(function () {
        textLayer.dataset.lastSelectionSyncAt = String(Date.now());
        const matchedTextBlock = syncDetectedTextSelectionFromViewer(pageNumber, textLayer, event);
        if (event.detail >= 2 && matchedTextBlock) {
          event.preventDefault();
          openDetectedTextBlockInlineEditor(getDetectedTextSelectionId(matchedTextBlock), { selectAll: false });
        }
      });
    });

    textLayer.addEventListener("click", function (event) {
      if (editorAnnotationState.activeTool !== "select") {
        return;
      }

      const lastSelectionSyncAt = Number(textLayer.dataset.lastSelectionSyncAt || 0);
      if (Date.now() - lastSelectionSyncAt < 140) {
        return;
      }

      window.requestAnimationFrame(function () {
        syncDetectedTextSelectionFromViewer(pageNumber, textLayer, event);
      });
    });
  }

  function syncDetectedTextSelectionFromViewer(pageNumber, textLayer, event) {
    const viewerSelection = getViewerTextSelection(textLayer);

    if (viewerSelection?.text) {
      editorTextState.selectedViewerText = viewerSelection.text;
      editorTextState.selectedViewerSelection = {
        bounds: viewerSelection.normalizedBounds,
        pageNumber: pageNumber,
        text: viewerSelection.text
      };
      const matchedTextBlock = resolveDetectedTextBlockFromNormalizedRect(pageNumber, viewerSelection.normalizedBounds, viewerSelection.text)
        || resolveDetectedTextBlockFromClientRect(pageNumber, textLayer, viewerSelection.bounds, viewerSelection.text);
      if (matchedTextBlock) {
        selectDetectedTextBlock(getDetectedTextSelectionId(matchedTextBlock), false, { preserveViewerSelection: true });
        return matchedTextBlock;
      } else {
        updateDetectedTextControls();
      }
      return null;
    }

    const pointSelection = getViewerPointSelection(textLayer, event);
    clearNativeViewerTextSelection();

    if (pointSelection) {
      const pointTextBlock = resolveDetectedTextBlockFromSpan(pageNumber, textLayer, pointSelection.spanElement)
        || resolveDetectedTextBlockFromNormalizedRect(pageNumber, pointSelection.bounds, pointSelection.text)
        || resolveDetectedTextBlockFromPoint(pageNumber, textLayer, event.clientX, event.clientY);
      clearStoredViewerTextSelection();
      if (pointTextBlock) {
        selectDetectedTextBlock(getDetectedTextSelectionId(pointTextBlock), false);
        return pointTextBlock;
      } else {
        updateDetectedTextControls();
      }
    } else {
      clearStoredViewerTextSelection();
      updateDetectedTextControls();
      renderDetectedTextBlocks();
    }

    return null;
  }

  function resolveDetectedTextBlockFromViewerInteraction(pageNumber, textLayer, event) {
    const pointSelection = getViewerPointSelection(textLayer, event);
    if (pointSelection) {
      return resolveDetectedTextBlockFromSpan(pageNumber, textLayer, pointSelection.spanElement)
        || resolveDetectedTextBlockFromNormalizedRect(pageNumber, pointSelection.bounds, pointSelection.text)
        || resolveDetectedTextBlockFromPoint(pageNumber, textLayer, event.clientX, event.clientY);
    }

    return resolveDetectedTextBlockFromPoint(pageNumber, textLayer, event.clientX, event.clientY);
  }

  function getViewerTextSelection(textLayer) {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!isNodeInsideElement(range.commonAncestorContainer, textLayer)) {
      return null;
    }

    const selectedText = normalizeClipboardTextValue(selection.toString());
    const bounds = range.getBoundingClientRect();
    if (!selectedText || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    return {
      bounds,
      normalizedBounds: normalizeClientRectToLayer(bounds, textLayer.getBoundingClientRect()),
      text: selectedText
    };
  }

  function getViewerPointSelection(textLayer, event) {
    const spanElement = event.target.closest(".pdfjs-text-span");
    if (!spanElement) {
      return null;
    }

    const layerRect = textLayer.getBoundingClientRect();
    const spanRect = spanElement.getBoundingClientRect();
    const text = normalizeClipboardTextValue(spanElement.textContent || "");
    if (!text || layerRect.width <= 0 || layerRect.height <= 0 || spanRect.width <= 0 || spanRect.height <= 0) {
      return null;
    }

    return {
      bounds: normalizeClientRectToLayer(spanRect, layerRect),
      spanElement: spanElement,
      text
    };
  }

  function updateRenderedTextLayerHighlights(viewer) {
    for (let pageNumber = 1; pageNumber <= viewer.getPageCount(); pageNumber += 1) {
      const textLayer = viewer.getPageTextLayerElement(pageNumber);
      if (!textLayer) {
        continue;
      }

      textLayer.querySelectorAll(".pdfjs-text-span").forEach(function (spanElement) {
        spanElement.classList.remove("pdfjs-text-span--selected");
      });
    }
  }

  function doesClientRectOverlapTextBlock(clientRect, layerRect, textBlock) {
    if (!clientRect || clientRect.width <= 0 || clientRect.height <= 0 || layerRect.width <= 0 || layerRect.height <= 0) {
      return false;
    }

    const normalizedRect = normalizeClientRectToLayer(clientRect, layerRect);
    return Math.max(
      calculateRectOverlap(normalizedRect, textBlock),
      calculateMaxRectOverlapWithHitRegions(normalizedRect, textBlock)
    ) > 0.18;
  }

  function clearDetectedTextHitRegionCache() {
    editorTextState.hitRegionCache.clear();
  }

  function buildDetectedTextHitRegionCacheKey(textBlock) {
    if (!textBlock || typeof textBlock !== "object") {
      return "";
    }

    const selectionId = getDetectedTextSelectionId(textBlock);
    const previewLines = Array.isArray(textBlock.previewLines) ? textBlock.previewLines : [];
    const previewSignature = previewLines.map(function (previewLine) {
      const spans = Array.isArray(previewLine?.spans) ? previewLine.spans : [];
      return [
        Number(previewLine?.baselineY || previewLine?.y || 0).toFixed(3),
        Number(previewLine?.fontSize || 0).toFixed(3),
        spans.map(function (previewSpan) {
          return [
            Number(previewSpan?.x || 0).toFixed(3),
            Number(previewSpan?.width || 0).toFixed(3),
            String(previewSpan?.text || "")
          ].join(":");
        }).join("|")
      ].join(";");
    }).join("||");

    return [
      selectionId,
      getDetectedTextPreviewMode(textBlock),
      getDetectedTextPreviewCoordinateSpace(textBlock),
      Number(textBlock?.x || 0).toFixed(5),
      Number(textBlock?.y || 0).toFixed(5),
      Number(textBlock?.width || 0).toFixed(5),
      Number(textBlock?.height || 0).toFixed(5),
      Number(textBlock?.previewViewportWidth || 0).toFixed(3),
      Number(textBlock?.previewViewportHeight || 0).toFixed(3),
      previewSignature
    ].join("::");
  }

  function getDetectedTextHitTestBlock(textBlock) {
    if (!textBlock || typeof textBlock !== "object") {
      return null;
    }

    if (getDetectedTextPreviewMode(textBlock) === "preserved-source") {
      return getPreservedSourceRenderTextBlock(textBlock);
    }

    return textBlock;
  }

  function getDetectedTextHitRegions(textBlock) {
    const renderTextBlock = getDetectedTextHitTestBlock(textBlock);
    if (!renderTextBlock) {
      return [];
    }

    const cacheKey = buildDetectedTextHitRegionCacheKey(renderTextBlock);
    if (!cacheKey) {
      return [];
    }

    const cachedRegions = editorTextState.hitRegionCache.get(cacheKey);
    if (cachedRegions) {
      return cachedRegions;
    }

    const previewViewportWidth = Math.max(getDetectedTextPreviewViewportWidth(renderTextBlock), 1);
    const previewViewportHeight = Math.max(getDetectedTextPreviewViewportHeight(renderTextBlock), 1);
    const lineHeightRatio = Math.max(Number(renderTextBlock?.lineHeightRatio) || 1.15, 1.0);
    const previewLines = Array.isArray(renderTextBlock?.previewLines) && renderTextBlock.previewLines.length
      ? renderTextBlock.previewLines
      : buildFallbackPreviewLines(renderTextBlock);
    const hitRegions = [];

    previewLines.forEach(function (previewLine, lineIndex) {
      const previewSpans = Array.isArray(previewLine?.spans) && previewLine.spans.length
        ? previewLine.spans
        : [previewLine];
      const baselineY = Number(previewLine?.baselineY) > 0
        ? Number(previewLine.baselineY)
        : Math.max(
            (Number(previewLine?.y) || 0)
            + (Number(previewLine?.fontSize) || Number(renderTextBlock?.renderedFontSize) || Number(renderTextBlock?.fontSize) || 12),
            0
          );

      previewSpans.forEach(function (previewSpan, spanIndex) {
        const spanText = String(previewSpan?.text || previewLine?.text || "");
        if (!spanText.trim()) {
          return;
        }

        const localFontSize = Math.max(
          Number(previewSpan?.fontSize)
          || Number(previewLine?.fontSize)
          || Number(renderTextBlock?.renderedFontSize)
          || Number(renderTextBlock?.fontSize)
          || 12,
          1
        );
        const localX = Math.max(Number(previewSpan?.x) || Number(previewLine?.x) || 0, 0);
        const localWidth = Math.max(
          Number(previewSpan?.width) || 0,
          estimateRenderedTextWidth(spanText, localFontSize),
          1
        );
        const localTop = Math.max(baselineY - localFontSize, 0);
        const localHeight = Math.max(localFontSize * lineHeightRatio, localFontSize);
        const normalizedWidth = clamp((localWidth / previewViewportWidth) * Math.max(Number(renderTextBlock?.width) || 0, 0.0001), 0.0005, 1);
        const normalizedHeight = clamp((localHeight / previewViewportHeight) * Math.max(Number(renderTextBlock?.height) || 0, 0.0001), 0.0005, 1);

        hitRegions.push({
          colorHex: normalizeDetectedTextColorHex(previewSpan?.colorHex || previewLine?.colorHex || renderTextBlock?.colorHex || "#0f172a"),
          fontName: String(previewSpan?.fontName || previewLine?.fontName || renderTextBlock?.fontName || "").trim(),
          fontSize: localFontSize,
          height: normalizedHeight,
          isBold: typeof previewSpan?.isBold === "boolean" ? previewSpan.isBold : !!previewLine?.isBold,
          isItalic: typeof previewSpan?.isItalic === "boolean" ? previewSpan.isItalic : !!previewLine?.isItalic,
          lineIndex,
          spanIndex,
          text: normalizeClipboardTextValue(spanText),
          width: normalizedWidth,
          x: clamp((Number(renderTextBlock?.x) || 0) + (localX / previewViewportWidth) * (Number(renderTextBlock?.width) || 0), 0, 1),
          y: clamp((Number(renderTextBlock?.y) || 0) + (localTop / previewViewportHeight) * (Number(renderTextBlock?.height) || 0), 0, 1)
        });
      });
    });

    editorTextState.hitRegionCache.set(cacheKey, hitRegions);
    return hitRegions;
  }

  function calculateMaxRectOverlapWithHitRegions(normalizedRect, textBlock) {
    return getDetectedTextHitRegions(textBlock).reduce(function (maxOverlap, hitRegion) {
      return Math.max(maxOverlap, calculateRectOverlap(normalizedRect, hitRegion));
    }, 0);
  }

  function calculateMinPointDistanceToHitRegions(point, textBlock) {
    const hitRegions = getDetectedTextHitRegions(textBlock);
    if (!hitRegions.length) {
      return Number.POSITIVE_INFINITY;
    }

    return hitRegions.reduce(function (minimumDistance, hitRegion) {
      return Math.min(minimumDistance, calculatePointToRectDistance(point, hitRegion));
    }, Number.POSITIVE_INFINITY);
  }

  function isPointInsideDetectedTextHitRegions(point, textBlock) {
    return getDetectedTextHitRegions(textBlock).some(function (hitRegion) {
      return isPointInsideDetectedTextBlock(point, hitRegion);
    });
  }

  function resolveDetectedTextPreferredStyle(textBlock) {
    const exactBlockStyle = buildDetectedTextExactStyle(textBlock, textBlock);
    const hasRunLevelIdentity = !!(
      textBlock?.editableRunId
      || textBlock?.sourceEditableRunId
      || textBlock?.fontResourceName
      || textBlock?.sourceFontResourceName
    );
    const hitRegions = getDetectedTextHitRegions(textBlock);
    const viewerSelection = editorTextState.selectedViewerSelection;
    const selectionBounds = viewerSelection && viewerSelection.pageNumber === textBlock?.pageNumber
      ? viewerSelection.bounds
      : null;

    if (selectionBounds && hitRegions.length) {
      const matchedHitRegion = hitRegions
        .map(function (hitRegion) {
          return {
            hitRegion,
            overlap: calculateRectOverlap(selectionBounds, hitRegion),
            pointDistance: calculatePointToRectDistance(
              {
                x: selectionBounds.x + selectionBounds.width / 2,
                y: selectionBounds.y + selectionBounds.height / 2
              },
              hitRegion
            )
          };
        })
        .filter(function (candidate) {
          return candidate.overlap > 0 || candidate.pointDistance <= 0.015;
        })
        .sort(function (left, right) {
          if (right.overlap !== left.overlap) {
            return right.overlap - left.overlap;
          }

          if (left.pointDistance !== right.pointDistance) {
            return left.pointDistance - right.pointDistance;
          }

          return (right.hitRegion.text || "").length - (left.hitRegion.text || "").length;
        })[0]?.hitRegion;

      if (matchedHitRegion) {
        return buildDetectedTextExactStyle(textBlock, matchedHitRegion);
      }
    }

    if (hasRunLevelIdentity) {
      return exactBlockStyle;
    }

    if (hitRegions.length) {
      const weightedStyles = new Map();
      hitRegions.forEach(function (hitRegion) {
        const key = [
          hitRegion.fontName || "",
          Number(hitRegion.fontSize || 12).toFixed(2),
          normalizeDetectedTextColorHex(hitRegion.colorHex || "#0f172a").toLowerCase(),
          hitRegion.isBold ? "1" : "0",
          hitRegion.isItalic ? "1" : "0"
        ].join("|");
        const weight = Math.max((hitRegion.text || "").length, 1) * Math.max(hitRegion.width, 0.0005) * Math.max(hitRegion.height, 0.0005);
        const existing = weightedStyles.get(key);
        if (existing) {
          existing.weight += weight;
          return;
        }

        weightedStyles.set(key, {
          colorHex: normalizeDetectedTextColorHex(hitRegion.colorHex || "#0f172a"),
          fontName: String(hitRegion.fontName || "").trim(),
          fontSize: Number(hitRegion.fontSize || textBlock?.fontSize || textBlock?.renderedFontSize || 12),
          isBold: !!hitRegion.isBold,
          isItalic: !!hitRegion.isItalic,
          weight
        });
      });

      const dominantStyle = Array.from(weightedStyles.values()).sort(function (left, right) {
        return right.weight - left.weight;
      })[0];

      if (dominantStyle) {
        return {
          ...exactBlockStyle,
          colorHex: dominantStyle.colorHex,
          fontName: dominantStyle.fontName,
          fontSize: dominantStyle.fontSize,
          isBold: dominantStyle.isBold,
          isItalic: dominantStyle.isItalic
        };
      }
    }

    return exactBlockStyle;
  }

  function resolveDetectedTextBlockFromClientRect(pageNumber, textLayer, clientRect, selectedText) {
    if (!clientRect || clientRect.width <= 0 || clientRect.height <= 0) {
      return null;
    }

    const layerRect = textLayer.getBoundingClientRect();
    if (layerRect.width <= 0 || layerRect.height <= 0) {
      return null;
    }

    const normalizedRect = normalizeClientRectToLayer(clientRect, layerRect);
    return resolveDetectedTextBlockFromNormalizedRect(pageNumber, normalizedRect, selectedText);
  }

  function resolveDetectedTextBlockFromNormalizedRect(pageNumber, normalizedRect, selectedText) {
    if (!normalizedRect || normalizedRect.width <= 0 || normalizedRect.height <= 0) {
      return null;
    }

    const normalizedSelectionText = normalizeClipboardTextValue(selectedText).toLowerCase();
    const selectionCenter = {
      x: normalizedRect.x + normalizedRect.width / 2,
      y: normalizedRect.y + normalizedRect.height / 2
    };
    return editorTextState.detectedTextBlocks
      .filter(function (textBlock) {
        return textBlock.pageNumber === pageNumber;
      })
      .map(function (textBlock) {
        const containsHitRegionCenter = isPointInsideDetectedTextHitRegions(selectionCenter, textBlock);
        const hitRegionOverlap = calculateMaxRectOverlapWithHitRegions(normalizedRect, textBlock);
        const hitRegionPointDistance = calculateMinPointDistanceToHitRegions(selectionCenter, textBlock);
        return {
          containsHitRegionCenter,
          containsSelectionCenter: isPointInsideDetectedTextBlock(selectionCenter, textBlock),
          distance: calculateRectCenterDistance(normalizedRect, textBlock),
          hitRegionOverlap,
          hitRegionPointDistance,
          overlap: calculateRectOverlap(normalizedRect, textBlock),
          pointDistance: calculatePointToRectDistance(selectionCenter, textBlock),
          sizeDistance: Math.abs((textBlock.width || 0) - normalizedRect.width) + Math.abs((textBlock.height || 0) - normalizedRect.height),
          textBlock,
          textLengthDelta: normalizedSelectionText ? Math.abs(normalizeClipboardTextValue(textBlock.text).length - normalizedSelectionText.length) : Number.MAX_SAFE_INTEGER,
          textScore: scoreDetectedTextMatch(textBlock.text, normalizedSelectionText)
        };
      })
      .filter(function (candidate) {
        return candidate.hitRegionOverlap > 0
          || candidate.overlap > 0
          || candidate.textScore > 0
          || candidate.hitRegionPointDistance <= 0.015
          || candidate.pointDistance <= 0.02;
      })
      .sort(function (left, right) {
        if (left.containsHitRegionCenter !== right.containsHitRegionCenter) {
          return left.containsHitRegionCenter ? -1 : 1;
        }

        if (right.hitRegionOverlap !== left.hitRegionOverlap) {
          return right.hitRegionOverlap - left.hitRegionOverlap;
        }

        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }

        if (right.textScore !== left.textScore) {
          return right.textScore - left.textScore;
        }

        if (left.containsSelectionCenter !== right.containsSelectionCenter) {
          return left.containsSelectionCenter ? -1 : 1;
        }

        if (left.hitRegionPointDistance !== right.hitRegionPointDistance) {
          return left.hitRegionPointDistance - right.hitRegionPointDistance;
        }

        if (left.sizeDistance !== right.sizeDistance) {
          return left.sizeDistance - right.sizeDistance;
        }

        if (left.pointDistance !== right.pointDistance) {
          return left.pointDistance - right.pointDistance;
        }

        if (left.textLengthDelta !== right.textLengthDelta) {
          return left.textLengthDelta - right.textLengthDelta;
        }

        if (left.distance !== right.distance) {
          return left.distance - right.distance;
        }

        const leftArea = (left.textBlock.width || 0) * (left.textBlock.height || 0);
        const rightArea = (right.textBlock.width || 0) * (right.textBlock.height || 0);
        return leftArea - rightArea;
      })[0]?.textBlock || null;
  }

  function resolveDetectedTextBlockFromSpan(pageNumber, textLayer, spanElement) {
    if (!spanElement || !textLayer) {
      return null;
    }

    const spanRect = spanElement.getBoundingClientRect();
    if (!spanRect || spanRect.width <= 0 || spanRect.height <= 0) {
      return null;
    }

    return resolveDetectedTextBlockFromClientRect(
      pageNumber,
      textLayer,
      inflateClientRect(spanRect, 6),
      normalizeClipboardTextValue(spanElement.textContent || "")
    );
  }

  function resolveDetectedTextBlockFromPoint(pageNumber, textLayer, clientX, clientY) {
    const layerRect = textLayer.getBoundingClientRect();
    if (layerRect.width <= 0 || layerRect.height <= 0) {
      return null;
    }

    const normalizedPoint = {
      x: clamp((clientX - layerRect.left) / layerRect.width, 0, 1),
      y: clamp((clientY - layerRect.top) / layerRect.height, 0, 1)
    };

    return editorTextState.detectedTextBlocks
      .filter(function (textBlock) {
        return textBlock.pageNumber === pageNumber;
      })
      .map(function (textBlock) {
        const isInsideHitRegion = isPointInsideDetectedTextHitRegions(normalizedPoint, textBlock);
        const hitRegionPointDistance = calculateMinPointDistanceToHitRegions(normalizedPoint, textBlock);
        return {
          hitRegionPointDistance,
          isInsideHitRegion,
          isInside: isPointInsideDetectedTextBlock(normalizedPoint, textBlock),
          pointDistance: calculatePointToRectDistance(normalizedPoint, textBlock),
          textBlock: textBlock
        };
      })
      .filter(function (candidate) {
        return candidate.isInsideHitRegion || candidate.isInside || candidate.hitRegionPointDistance <= 0.015 || candidate.pointDistance <= 0.02;
      })
      .sort(function (left, right) {
        if (left.isInsideHitRegion !== right.isInsideHitRegion) {
          return left.isInsideHitRegion ? -1 : 1;
        }

        if (left.hitRegionPointDistance !== right.hitRegionPointDistance) {
          return left.hitRegionPointDistance - right.hitRegionPointDistance;
        }

        if (left.isInside !== right.isInside) {
          return left.isInside ? -1 : 1;
        }

        if (left.pointDistance !== right.pointDistance) {
          return left.pointDistance - right.pointDistance;
        }

        const leftArea = (left.textBlock.width || 0) * (left.textBlock.height || 0);
        const rightArea = (right.textBlock.width || 0) * (right.textBlock.height || 0);
        return leftArea - rightArea;
      })[0]?.textBlock || null;
  }

  function isPointInsideDetectedTextBlock(point, textBlock) {
    return point.x >= textBlock.x &&
      point.x <= textBlock.x + textBlock.width &&
      point.y >= textBlock.y &&
      point.y <= textBlock.y + textBlock.height;
  }

  function normalizeClientRectToLayer(clientRect, layerRect) {
    return {
      height: clamp(clientRect.height / layerRect.height, 0, 1),
      width: clamp(clientRect.width / layerRect.width, 0, 1),
      x: clamp((clientRect.left - layerRect.left) / layerRect.width, 0, 1),
      y: clamp((clientRect.top - layerRect.top) / layerRect.height, 0, 1)
    };
  }

  function inflateClientRect(clientRect, padding) {
    return {
      bottom: clientRect.bottom + padding,
      height: clientRect.height + padding * 2,
      left: clientRect.left - padding,
      right: clientRect.right + padding,
      top: clientRect.top - padding,
      width: clientRect.width + padding * 2
    };
  }

  function calculateRectOverlap(left, right) {
    const overlapLeft = Math.max(left.x, right.x);
    const overlapTop = Math.max(left.y, right.y);
    const overlapRight = Math.min(left.x + left.width, right.x + right.width);
    const overlapBottom = Math.min(left.y + left.height, right.y + right.height);

    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
      return 0;
    }

    const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    const leftArea = Math.max(left.width * left.height, 0.0001);
    const rightArea = Math.max(right.width * right.height, 0.0001);
    return overlapArea / Math.min(leftArea, rightArea);
  }

  function calculateRectCenterDistance(left, right) {
    const leftCenterX = left.x + left.width / 2;
    const leftCenterY = left.y + left.height / 2;
    const rightCenterX = right.x + right.width / 2;
    const rightCenterY = right.y + right.height / 2;
    return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
  }

  function calculatePointToRectDistance(point, rect) {
    const nearestX = clamp(point.x, rect.x, rect.x + rect.width);
    const nearestY = clamp(point.y, rect.y, rect.y + rect.height);
    return Math.hypot(point.x - nearestX, point.y - nearestY);
  }

  function scoreDetectedTextMatch(sourceText, selectionText) {
    const normalizedSourceText = normalizeClipboardTextValue(sourceText).toLowerCase();
    if (!normalizedSourceText || !selectionText) {
      return 0;
    }

    if (normalizedSourceText === selectionText) {
      return 3;
    }

    if (normalizedSourceText.includes(selectionText)) {
      return 2;
    }

    if (selectionText.includes(normalizedSourceText)) {
      return 1;
    }

    return 0;
  }

  function isNodeInsideElement(node, element) {
    if (!node || !element) {
      return false;
    }

    const targetNode = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    return targetNode instanceof Element && element.contains(targetNode);
  }

  function buildDetectedTextBlockElement(textBlock, pageSurface) {
    const selectionId = getDetectedTextSelectionId(textBlock);
    const isEditing = editorTextState.editingTextBlockId === selectionId;
    const element = document.createElement("div");
    element.className = `detected-text-block${editorTextState.selectedTextBlockId === selectionId ? " detected-text-block--selected" : ""}${editorTextState.flashedTextBlockId === selectionId ? " detected-text-block--flash" : ""}`;
    if (textBlock.isOverlayObject || getDetectedTextPreviewMode(textBlock) === "preview") {
      element.classList.add("detected-text-block--overlay-object");
    }
    if (isEditing) {
      element.classList.add("detected-text-block--editing");
    }
    element.dataset.textBlockId = selectionId;
    element.title = textBlock.text;
    const previewBounds = getDetectedTextPreviewBounds(textBlock);
    applyDetectedTextElementBounds(element, previewBounds, pageSurface, textBlock);
    if (editorTextState.selectedTextBlockId === selectionId || editorTextState.dragInteraction?.textBlockId === selectionId) {
      element.classList.add("detected-text-block--interactive");
    }
    if (editorTextState.dragInteraction?.textBlockId === selectionId) {
      element.classList.add("detected-text-block--dragging");
    }
    if (editorTextState.selectedTextBlockId === selectionId && !isEditing) {
      element.appendChild(buildDetectedTextTransformHandle("move"));
      element.appendChild(buildDetectedTextTransformHandle("top-left"));
      element.appendChild(buildDetectedTextTransformHandle("top-right"));
      element.appendChild(buildDetectedTextTransformHandle("bottom-left"));
      element.appendChild(buildDetectedTextTransformHandle("bottom-right"));
    }
    if (isEditing) {
      element.appendChild(buildDetectedTextInlineEditorElement(textBlock, pageSurface));
    } else if (textBlock.isOverlayObject || getDetectedTextPreviewMode(textBlock) === "preview") {
      element.appendChild(buildDetectedTextOverlayContent(textBlock, pageSurface));
    }
    element.addEventListener("pointerdown", function (event) {
      if (event.target.closest(".detected-text-inline-shell")) {
        return;
      }

      if (event.target.closest(".detected-text-handle")) {
        return;
      }

      handleDetectedTextBlockSelectionPointerDown(event, textBlock, element);
    });

    element.addEventListener("dblclick", function (event) {
      if (editorAnnotationState.activeTool !== "select") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openDetectedTextBlockInlineEditor(selectionId, { selectAll: true });
    });

    if (element.classList.contains("detected-text-block--interactive")) {
      element.querySelectorAll(".detected-text-handle").forEach(function (handleElement) {
        handleElement.addEventListener("pointerdown", function (event) {
          handleDetectedTextPointerDown(event, textBlock, element);
        });
      });
    }
    return element;
  }

  function getDetectedTextPreviewMode(textBlock) {
    return String(textBlock?.previewMode || (textBlock?.isOverlayObject ? "preview" : "source")).toLowerCase();
  }

  function getDetectedTextPreviewCoordinateSpace(textBlock) {
    const normalizedPreviewCoordinateSpace = String(textBlock?.previewCoordinateSpace || "").trim().toLowerCase();
    return normalizedPreviewCoordinateSpace === "exact-local" ? "exact-local" : "legacy-fitted";
  }

  function getDetectedTextPreviewViewportWidth(textBlock) {
    const explicitWidth = Number(textBlock?.previewViewportWidth);
    if (explicitWidth > 0) {
      return explicitWidth;
    }

    const page = getDetectedTextPageMetrics(textBlock);
    if (page && Number(page.width) > 0) {
      return Math.max((Number(textBlock?.width) || 0) * Number(page.width), 0);
    }

    return 0;
  }

  function getDetectedTextPreviewViewportHeight(textBlock) {
    const explicitHeight = Number(textBlock?.previewViewportHeight);
    if (explicitHeight > 0) {
      return explicitHeight;
    }

    const page = getDetectedTextPageMetrics(textBlock);
    if (page && Number(page.height) > 0) {
      return Math.max((Number(textBlock?.height) || 0) * Number(page.height), 0);
    }

    return 0;
  }

  function getPreservedSourceRenderTextBlock(textBlock) {
    if (!textBlock || typeof textBlock !== "object") {
      return textBlock;
    }

    const sourcePreviewLines = Array.isArray(textBlock.sourcePreviewLines) ? textBlock.sourcePreviewLines : [];
    const sourcePreviewBackgrounds = Array.isArray(textBlock.sourcePreviewBackgrounds) ? textBlock.sourcePreviewBackgrounds : [];
    const sourceLayoutLines = Array.isArray(textBlock.sourceLayoutLines) ? textBlock.sourceLayoutLines : [];
    return {
      ...textBlock,
      width: Number(textBlock.sourceWidth) || Number(textBlock.width) || 0,
      height: Number(textBlock.sourceHeight) || Number(textBlock.height) || 0,
      fontSize: Number(textBlock.sourceFontSize) || Number(textBlock.fontSize) || Number(textBlock.renderedFontSize) || 12,
      renderedFontSize: Number(textBlock.sourceRenderedFontSize) || Number(textBlock.renderedFontSize) || Number(textBlock.fontSize) || 12,
      fontName: textBlock.sourceFontName || textBlock.fontName || "",
      colorHex: textBlock.sourceColorHex || textBlock.colorHex || "#0f172a",
      isBold: typeof textBlock.sourceIsBold === "boolean" ? textBlock.sourceIsBold : !!textBlock.isBold,
      isItalic: typeof textBlock.sourceIsItalic === "boolean" ? textBlock.sourceIsItalic : !!textBlock.isItalic,
      lineHeightRatio: Number(textBlock.sourceLineHeightRatio) || Number(textBlock.lineHeightRatio) || 1.15,
      previewCoordinateSpace: textBlock.sourcePreviewCoordinateSpace || textBlock.previewCoordinateSpace || "legacy-fitted",
      previewViewportWidth: Number(textBlock.sourcePreviewViewportWidth) || Number(textBlock.previewViewportWidth) || 0,
      previewViewportHeight: Number(textBlock.sourcePreviewViewportHeight) || Number(textBlock.previewViewportHeight) || 0,
      layoutLines: sourceLayoutLines.length ? sourceLayoutLines : (Array.isArray(textBlock.layoutLines) ? textBlock.layoutLines : []),
      previewLines: sourcePreviewLines.length ? sourcePreviewLines : (Array.isArray(textBlock.previewLines) ? textBlock.previewLines : []),
      previewBackgrounds: sourcePreviewBackgrounds.length ? sourcePreviewBackgrounds : (Array.isArray(textBlock.previewBackgrounds) ? textBlock.previewBackgrounds : [])
    };
  }

  function getDetectedTextPageMetrics(textBlock) {
    return editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    }) || null;
  }

  function getPreservedSourcePixelBounds(bounds, pageSurface) {
    const surfaceRect = pageSurface?.getBoundingClientRect();
    if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) {
      return null;
    }

    return {
      leftPx: (Number(bounds?.x) || 0) * surfaceRect.width,
      topPx: (Number(bounds?.y) || 0) * surfaceRect.height,
      widthPx: Math.max(Math.max(Number(bounds?.width) || 0, 0.01) * surfaceRect.width, 1),
      heightPx: Math.max(Math.max(Number(bounds?.height) || 0, 0.01) * surfaceRect.height, 1)
    };
  }

  function getPreservedSourceCanvasCropBounds(textBlock, renderTextBlock, pageCanvas) {
    if (!textBlock || !renderTextBlock || !pageCanvas) {
      return null;
    }

    const sourceX = clamp(Number(textBlock.sourceX ?? textBlock.x) || 0, 0, 1);
    const sourceY = clamp(Number(textBlock.sourceY ?? textBlock.y) || 0, 0, 1);
    const sourceWidth = clamp(Number(renderTextBlock.width) || 0, 0.0001, Math.max(1 - sourceX, 0.0001));
    const sourceHeight = clamp(Number(renderTextBlock.height) || 0, 0.0001, Math.max(1 - sourceY, 0.0001));
    const leftPx = Math.max(Math.floor(sourceX * pageCanvas.width), 0);
    const topPx = Math.max(Math.floor(sourceY * pageCanvas.height), 0);
    const rightPx = Math.min(Math.ceil((sourceX + sourceWidth) * pageCanvas.width), pageCanvas.width);
    const bottomPx = Math.min(Math.ceil((sourceY + sourceHeight) * pageCanvas.height), pageCanvas.height);
    const widthPx = Math.max(rightPx - leftPx, 1);
    const heightPx = Math.max(bottomPx - topPx, 1);

    return {
      leftPx,
      topPx,
      widthPx,
      heightPx
    };
  }

  function applyDetectedTextElementBounds(element, bounds, pageSurface, textBlock) {
    if (!element) {
      return;
    }

    element.style.left = `${bounds.x * 100}%`;
    element.style.top = `${bounds.y * 100}%`;
    element.style.width = `${Math.max(bounds.width, 0.01) * 100}%`;
    element.style.height = `${Math.max(bounds.height, 0.01) * 100}%`;
  }

  function canRenderPreservedSourceTextBlock(textBlock, pageSurface) {
    const renderTextBlock = getPreservedSourceRenderTextBlock(textBlock);
    const pageCanvas = pageSurface?.querySelector(".pdfjs-page-canvas");
    const cropBounds = getPreservedSourceCanvasCropBounds(textBlock, renderTextBlock, pageCanvas);
    return !!renderTextBlock
      && (Number(renderTextBlock.width) || 0) > 0
      && (Number(renderTextBlock.height) || 0) > 0
      && !!pageCanvas
      && (Number(pageCanvas.width) || 0) > 0
      && (Number(pageCanvas.height) || 0) > 0
      && !!cropBounds
      && cropBounds.widthPx > 0
      && cropBounds.heightPx > 0;
  }

  function warnDetectedTextPreviewFallback(textBlock, message) {
    const warningId = getDetectedTextSelectionId(textBlock);
    if (!warningId || editorTextState.preservedSourceFallbackWarningIds.has(warningId)) {
      return;
    }

    editorTextState.preservedSourceFallbackWarningIds.add(warningId);
    setStatus(editorTextState.operationStatusElement || editorTextState.statusElement, message, false);
  }

  function buildDetectedTextSourceMaskElement(textBlock) {
    const maskElement = document.createElement("div");
    maskElement.className = "detected-text-source-mask";
    maskElement.style.left = `${textBlock.sourceX * 100}%`;
    maskElement.style.top = `${textBlock.sourceY * 100}%`;
    maskElement.style.width = `${Math.max(textBlock.sourceWidth, 0.01) * 100}%`;
    maskElement.style.height = `${Math.max(textBlock.sourceHeight, 0.01) * 100}%`;
    const sourceBackgrounds = Array.isArray(textBlock?.sourcePreviewBackgrounds) && textBlock.sourcePreviewBackgrounds.length
      ? textBlock.sourcePreviewBackgrounds
      : [];
    maskElement.appendChild(buildDetectedTextMaskBaseElement(textBlock, "detected-text-source-mask-base"));

    if (!sourceBackgrounds.length) {
      maskElement.classList.add("detected-text-source-mask--solid");
      return maskElement;
    }

    sourceBackgrounds.forEach(function (previewBackground, backgroundIndex) {
      const backgroundElement = document.createElement("div");
      backgroundElement.className = "detected-text-source-mask-background";
      backgroundElement.style.left = `${Math.max(Number(previewBackground.x) || 0, 0) * 100}%`;
      backgroundElement.style.top = `${Math.max(Number(previewBackground.y) || 0, 0) * 100}%`;
      backgroundElement.style.width = `${Math.max(Number(previewBackground.width) || 0, 0) * 100}%`;
      backgroundElement.style.height = `${Math.max(Number(previewBackground.height) || 0, 0) * 100}%`;
      backgroundElement.style.backgroundColor = resolveDetectedTextColor({ colorHex: previewBackground.colorHex });
      backgroundElement.style.opacity = `${Math.max(Math.min(Number(previewBackground.opacity) || 1, 1), 0)}`;
      backgroundElement.dataset.sourceBackgroundIndex = String(backgroundIndex);
      maskElement.appendChild(backgroundElement);
    });

    return maskElement;
  }

  function buildDetectedTextOverlayContent(textBlock, pageSurface) {
    const previewMode = getDetectedTextPreviewMode(textBlock);
    if (previewMode === "preserved-source") {
      if (canRenderPreservedSourceTextBlock(textBlock, pageSurface)) {
        const preservedSourceElement = buildDetectedTextPreservedSourceContent(textBlock, pageSurface);
        if (preservedSourceElement) {
          return preservedSourceElement;
        }
      }

      const renderTextBlock = getPreservedSourceRenderTextBlock(textBlock);
      if (renderTextBlock && Array.isArray(renderTextBlock.previewLines) && renderTextBlock.previewLines.length) {
        warnDetectedTextPreviewFallback(
          textBlock,
          "Moved text is using exact preview fallback; slight visual shift may occur until save."
        );
        return buildDetectedTextPreviewOverlayContent(
          renderTextBlock,
          pageSurface,
          {
            disableSpanFitting: true,
            previewLines: renderTextBlock.previewLines
          }
        );
      }

      warnDetectedTextPreviewFallback(
        textBlock,
        "Moved text is using preview mode; slight visual shift may occur until save."
      );
      return buildDetectedTextPreviewOverlayContent(textBlock, pageSurface);
    }

    return buildDetectedTextPreviewOverlayContent(textBlock, pageSurface);
  }

  function buildDetectedTextPreservedSourceContent(textBlock, pageSurface) {
    const renderTextBlock = getPreservedSourceRenderTextBlock(textBlock);
    const pageCanvas = pageSurface?.querySelector(".pdfjs-page-canvas");
    const cropBounds = getPreservedSourceCanvasCropBounds(textBlock, renderTextBlock, pageCanvas);
    if (!renderTextBlock || !pageCanvas || !cropBounds) {
      return null;
    }

    const preservedCanvas = document.createElement("canvas");
    preservedCanvas.className = "detected-text-preserved-source-canvas";
    preservedCanvas.width = cropBounds.widthPx;
    preservedCanvas.height = cropBounds.heightPx;
    preservedCanvas.setAttribute("aria-hidden", "true");
    const context = preservedCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.clearRect(0, 0, cropBounds.widthPx, cropBounds.heightPx);
    context.drawImage(
      pageCanvas,
      cropBounds.leftPx,
      cropBounds.topPx,
      cropBounds.widthPx,
      cropBounds.heightPx,
      0,
      0,
      cropBounds.widthPx,
      cropBounds.heightPx
    );
    applyPreservedSourceTransparencyMask(context, renderTextBlock);

    return preservedCanvas;
  }

  function applyPreservedSourceTransparencyMask(context, textBlock) {
    const width = context.canvas.width;
    const height = context.canvas.height;
    if (width <= 0 || height <= 0) {
      return;
    }

    const imageData = context.getImageData(0, 0, width, height);
    const pixelData = imageData.data;
    const backgroundCandidates = getPreservedSourceBackgroundCandidates(pixelData, width, height, textBlock);
    if (!backgroundCandidates.length) {
      return;
    }

    // Keep moved text fully opaque and only cut pixels that are extremely close
    // to the sampled background. The previous gradient fade softened glyph edges
    // enough to make preserved-source text look washed out.
    const backgroundRemovalDistance = 6;

    for (let index = 0; index < pixelData.length; index += 4) {
      const alpha = pixelData[index + 3];
      if (alpha === 0) {
        continue;
      }

      const red = pixelData[index];
      const green = pixelData[index + 1];
      const blue = pixelData[index + 2];
      const backgroundDistance = getPreservedSourceBackgroundDistance(red, green, blue, backgroundCandidates);
      if (backgroundDistance <= backgroundRemovalDistance) {
        pixelData[index + 3] = 0;
      }
    }

    context.putImageData(imageData, 0, 0);
  }

  function getPreservedSourceBackgroundCandidates(pixelData, width, height, textBlock) {
    const candidates = [];
    const edgeBuckets = new Map();
    const pushCandidate = function (red, green, blue) {
      if (![red, green, blue].every(Number.isFinite)) {
        return;
      }

      if (candidates.some(function (candidate) {
        return Math.abs(candidate.red - red) <= 2
          && Math.abs(candidate.green - green) <= 2
          && Math.abs(candidate.blue - blue) <= 2;
      })) {
        return;
      }

      candidates.push({ red, green, blue });
    };
    const pushEdgeSample = function (red, green, blue) {
      if (![red, green, blue].every(Number.isFinite)) {
        return;
      }

      const bucketRed = Math.round(red / 6) * 6;
      const bucketGreen = Math.round(green / 6) * 6;
      const bucketBlue = Math.round(blue / 6) * 6;
      const bucketKey = `${bucketRed},${bucketGreen},${bucketBlue}`;
      const existingBucket = edgeBuckets.get(bucketKey);
      if (existingBucket) {
        existingBucket.count += 1;
        return;
      }

      edgeBuckets.set(bucketKey, {
        blue: bucketBlue,
        count: 1,
        green: bucketGreen,
        red: bucketRed
      });
    };

    [{ colorHex: "#ffffff" }]
      .concat(Array.isArray(textBlock?.previewBackgrounds) ? textBlock.previewBackgrounds : [])
      .forEach(function (background) {
        const rgb = hexToRgbTriplet(background?.colorHex || "#ffffff");
        if (rgb) {
          pushCandidate(rgb.red, rgb.green, rgb.blue);
        }
      });

    const horizontalStep = Math.max(Math.floor(width / 10), 1);
    const verticalStep = Math.max(Math.floor(height / 8), 1);
    const samplePixel = function (x, y) {
      const clampedX = Math.max(Math.min(x, width - 1), 0);
      const clampedY = Math.max(Math.min(y, height - 1), 0);
      const sampleIndex = ((clampedY * width) + clampedX) * 4;
      if (sampleIndex + 2 >= pixelData.length) {
        return;
      }

      pushEdgeSample(pixelData[sampleIndex], pixelData[sampleIndex + 1], pixelData[sampleIndex + 2]);
    };

    for (let sampleX = 0; sampleX < width; sampleX += horizontalStep) {
      samplePixel(sampleX, 0);
      samplePixel(sampleX, Math.max(height - 1, 0));
    }

    for (let sampleY = 0; sampleY < height; sampleY += verticalStep) {
      samplePixel(0, sampleY);
      samplePixel(Math.max(width - 1, 0), sampleY);
    }

    Array.from(edgeBuckets.values())
      .sort(function (leftBucket, rightBucket) {
        return rightBucket.count - leftBucket.count;
      })
      .slice(0, 6)
      .forEach(function (bucket) {
        pushCandidate(bucket.red, bucket.green, bucket.blue);
      });

    return candidates;
  }

  function getPreservedSourceBackgroundDistance(red, green, blue, candidates) {
    if (!Array.isArray(candidates) || !candidates.length) {
      return Number.POSITIVE_INFINITY;
    }

    return candidates.reduce(function (minimumDistance, candidate) {
      const channelDistance = Math.max(
        Math.abs(candidate.red - red),
        Math.abs(candidate.green - green),
        Math.abs(candidate.blue - blue)
      );
      return Math.min(minimumDistance, channelDistance);
    }, Number.POSITIVE_INFINITY);
  }

  function hexToRgbTriplet(colorHex) {
    const normalizedColor = String(colorHex || "").trim();
    const match = /^#([0-9a-f]{6})$/i.exec(normalizedColor);
    if (!match) {
      return null;
    }

    return {
      red: Number.parseInt(match[1].slice(0, 2), 16),
      green: Number.parseInt(match[1].slice(2, 4), 16),
      blue: Number.parseInt(match[1].slice(4, 6), 16)
    };
  }

  function buildDetectedTextPreviewOverlayContent(textBlock, pageSurface, options) {
    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      return buildDetectedTextExactPreviewOverlayContent(textBlock, pageSurface, options);
    }

    return buildDetectedTextLegacyPreviewOverlayContent(textBlock, pageSurface, options);
  }

  function buildDetectedTextExactPreviewOverlayContent(textBlock, pageSurface, options) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const contentElement = document.createElementNS(svgNamespace, "svg");
    const previewLines = Array.isArray(options?.previewLines) && options.previewLines.length
      ? options.previewLines
      : Array.isArray(textBlock?.previewLines) && textBlock.previewLines.length
        ? textBlock.previewLines
        : buildFallbackPreviewLines(textBlock);
    const previewViewportWidth = Math.max(getDetectedTextPreviewViewportWidth(textBlock), 1);
    const previewViewportHeight = Math.max(getDetectedTextPreviewViewportHeight(textBlock), 1);

    contentElement.classList.add("detected-text-overlay-svg");
    contentElement.dataset.coordinateSpace = "exact-local";
    contentElement.setAttribute("preserveAspectRatio", "none");
    contentElement.setAttribute("aria-hidden", "true");
    contentElement.setAttribute("viewBox", `0 0 ${previewViewportWidth} ${previewViewportHeight}`);
    contentElement.style.overflow = "visible";

    previewLines.forEach(function (previewLine, lineIndex) {
      const lineElement = document.createElementNS(svgNamespace, "text");
      lineElement.classList.add("detected-text-overlay-line");
      lineElement.setAttribute("data-preview-line-index", String(lineIndex));
      lineElement.setAttribute("dominant-baseline", "alphabetic");
      lineElement.setAttribute("xml:space", "preserve");
      lineElement.setAttribute("text-rendering", "geometricPrecision");
      const previewSpans = Array.isArray(previewLine?.spans) && previewLine.spans.length
        ? previewLine.spans
        : [previewLine];
      const baselineY = Number(previewLine?.baselineY) > 0
        ? Number(previewLine.baselineY)
        : Math.max((Number(previewLine?.y) || 0) + (Number(previewLine?.fontSize) || Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12), 0);

      previewSpans.forEach(function (previewSpan, spanIndex) {
        const spanElement = document.createElementNS(svgNamespace, "tspan");
        spanElement.classList.add("detected-text-overlay-span");
        spanElement.textContent = previewSpan.text || " ";
        spanElement.setAttribute("x", String(Math.max(Number(previewSpan?.x) || Number(previewLine?.x) || 0, 0)));
        spanElement.setAttribute("y", String(baselineY));
        spanElement.setAttribute("font-size", String(Math.max(Number(previewSpan?.fontSize) || Number(previewLine?.fontSize) || Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12, 1)));
        spanElement.setAttribute("font-family", mapPdfFontNameToCss(previewSpan.fontName || previewLine.fontName || textBlock.fontName, textBlock, previewSpan.fontName ? previewSpan : previewLine));
        spanElement.setAttribute("fill", resolveDetectedTextColor(previewSpan.colorHex ? { colorHex: previewSpan.colorHex } : previewLine.colorHex ? { colorHex: previewLine.colorHex } : textBlock));
        spanElement.setAttribute("font-weight", resolveDetectedTextFontWeight(previewSpan));
        spanElement.setAttribute("font-style", resolveDetectedTextFontStyle(previewSpan));
        spanElement.setAttribute("data-preview-span-index", String(spanIndex));
        lineElement.appendChild(spanElement);
      });

      contentElement.appendChild(lineElement);
    });

    return contentElement;
  }

  function buildDetectedTextLegacyPreviewOverlayContent(textBlock, pageSurface, options) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const contentElement = document.createElementNS(svgNamespace, "svg");
    contentElement.classList.add("detected-text-overlay-svg");
    contentElement.setAttribute("preserveAspectRatio", "none");
    contentElement.setAttribute("aria-hidden", "true");
    const renderedWidth = Math.max(getDisplayedDetectedTextWidth(textBlock, pageSurface), 1);
    const renderedHeight = Math.max(getDisplayedDetectedTextHeight(textBlock, pageSurface), 1);
    contentElement.setAttribute("viewBox", `0 0 ${renderedWidth} ${renderedHeight}`);
    const previewLines = Array.isArray(options?.previewLines) && options.previewLines.length
      ? options.previewLines
      : Array.isArray(textBlock?.previewLines) && textBlock.previewLines.length
        ? textBlock.previewLines
        : buildFallbackPreviewLines(textBlock);

    previewLines.forEach(function (previewLine, lineIndex) {
      const lineElement = document.createElementNS(svgNamespace, "text");
      lineElement.classList.add("detected-text-overlay-line");
      lineElement.setAttribute("data-preview-line-index", String(lineIndex));
      lineElement.setAttribute("dominant-baseline", "hanging");
      lineElement.setAttribute("xml:space", "preserve");
      const previewSpans = Array.isArray(previewLine?.spans) && previewLine.spans.length
        ? previewLine.spans
        : [previewLine];

      previewSpans.forEach(function (previewSpan, spanIndex) {
        const spanWidth = getStableDisplayedPreviewSpanWidth(previewSpan, previewLine, textBlock, pageSurface);
        const spanElement = document.createElementNS(svgNamespace, "tspan");
        spanElement.classList.add("detected-text-overlay-span");
        spanElement.textContent = previewSpan.text || " ";
        spanElement.setAttribute("x", String(getDisplayedPreviewOffsetX(previewSpan.x, textBlock, pageSurface)));
        spanElement.setAttribute("y", String(getDisplayedPreviewOffsetY(previewLine.y, textBlock, pageSurface)));
        spanElement.setAttribute("font-size", String(getDisplayedPreviewLineFontSize(previewSpan, textBlock, pageSurface)));
        spanElement.setAttribute("font-family", mapPdfFontNameToCss(previewSpan.fontName || previewLine.fontName || textBlock.fontName, textBlock, previewSpan.fontName ? previewSpan : previewLine));
        spanElement.setAttribute("fill", resolveDetectedTextColor(previewSpan.colorHex ? { colorHex: previewSpan.colorHex } : previewLine.colorHex ? { colorHex: previewLine.colorHex } : textBlock));
        spanElement.setAttribute("font-weight", resolveDetectedTextFontWeight(previewSpan));
        spanElement.setAttribute("font-style", resolveDetectedTextFontStyle(previewSpan));
        spanElement.setAttribute("data-preview-span-index", String(spanIndex));
        if (!options?.disableSpanFitting && spanWidth > 0.5) {
          spanElement.setAttribute("textLength", String(spanWidth));
          spanElement.setAttribute("lengthAdjust", "spacing");
        }
        lineElement.appendChild(spanElement);
      });

      contentElement.appendChild(lineElement);
    });

    return contentElement;
  }

  function buildDetectedTextInlineEditorElement(textBlock, pageSurface) {
    const selectionId = getDetectedTextSelectionId(textBlock);
    const wrapperElement = document.createElement("div");
    wrapperElement.className = "detected-text-inline-shell";
    wrapperElement.dataset.textBlockId = selectionId;

    const backdropElement = buildDetectedTextInlineEditorBackdrop(textBlock);
    if (backdropElement) {
      wrapperElement.appendChild(backdropElement);
    }

    wrapperElement.appendChild(buildDetectedTextInlineToolbarElement(textBlock, pageSurface));

    const textareaElement = document.createElement("textarea");
    textareaElement.className = "detected-text-inline-editor";
    textareaElement.dataset.textBlockId = selectionId;
    textareaElement.spellcheck = false;
    textareaElement.value = getInlineDetectedTextValue(textBlock);
    textareaElement.setAttribute("aria-label", "Edit selected PDF text inline");
    applyDetectedTextStyleToInlineEditor(textareaElement, textBlock, pageSurface);

    ["pointerdown", "click", "dblclick", "contextmenu"].forEach(function (eventName) {
      textareaElement.addEventListener(eventName, function (event) {
        event.stopPropagation();
      });
    });

    textareaElement.addEventListener("focus", function () {
      editorTextState.editingTextBlockId = selectionId;
      syncDetectedTextDraftValue(textareaElement.value, "inline");
    });

    textareaElement.addEventListener("input", function () {
      syncDetectedTextDraftValue(textareaElement.value, "inline");
    });

    textareaElement.addEventListener("blur", function () {
      scheduleInlineDetectedTextAutoApply(selectionId);
    });

    textareaElement.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key.toLowerCase() === "s")) {
        event.preventDefault();
        document.getElementById("apply-text-change")?.click();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelInlineDetectedTextEditing();
      }
    });

    wrapperElement.appendChild(textareaElement);

    if (editorTextState.inlineEditorPendingFocus && editorTextState.editingTextBlockId === selectionId) {
      window.requestAnimationFrame(function () {
        if (!document.body.contains(textareaElement)) {
          return;
        }

        textareaElement.focus({ preventScroll: true });
        if (editorTextState.inlineEditorSelectAllOnFocus) {
          textareaElement.select();
        }

        editorTextState.inlineEditorPendingFocus = false;
        editorTextState.inlineEditorSelectAllOnFocus = false;
      });
    }

    return wrapperElement;
  }

  function buildDetectedTextInlineToolbarElement(textBlock, pageSurface) {
    const selectionId = getDetectedTextSelectionId(textBlock);
    const nextStyle = getPendingDetectedTextStyle(textBlock);
    const inlineMetrics = getDetectedTextInlineMetrics(textBlock, pageSurface);
    const toolbarElement = document.createElement("div");
    toolbarElement.className = "detected-text-inline-toolbar";
    toolbarElement.dataset.textBlockId = selectionId;

    ["pointerdown", "click", "dblclick", "contextmenu"].forEach(function (eventName) {
      toolbarElement.addEventListener(eventName, function (event) {
        event.stopPropagation();
      });
    });

    const summaryElement = document.createElement("div");
    summaryElement.className = "detected-text-inline-summary";

    const colorSwatchElement = document.createElement("span");
    colorSwatchElement.className = "detected-text-inline-swatch";
    colorSwatchElement.style.backgroundColor = resolveDetectedTextColor({ colorHex: nextStyle.colorHex || inlineMetrics.primaryColorHex });
    summaryElement.appendChild(colorSwatchElement);

    const metaElement = document.createElement("span");
    metaElement.className = "detected-text-inline-meta";
    metaElement.textContent = buildDetectedTextInlineMetaLabel(textBlock, nextStyle, inlineMetrics);
    summaryElement.appendChild(metaElement);

    if (inlineMetrics.hasMixedStyles) {
      const mixedBadgeElement = document.createElement("span");
      mixedBadgeElement.className = "detected-text-inline-badge";
      mixedBadgeElement.textContent = "Mixed styles";
      summaryElement.appendChild(mixedBadgeElement);
    }

    toolbarElement.appendChild(summaryElement);

    const actionsElement = document.createElement("div");
    actionsElement.className = "detected-text-inline-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "detected-text-inline-button detected-text-inline-button--ghost";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", function () {
      cancelInlineDetectedTextEditing();
    });
    actionsElement.appendChild(cancelButton);

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "detected-text-inline-button detected-text-inline-button--primary";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", function () {
      document.getElementById("apply-text-change")?.click();
    });
    actionsElement.appendChild(applyButton);

    toolbarElement.appendChild(actionsElement);
    return toolbarElement;
  }

  function buildDetectedTextInlineEditorBackdrop(textBlock) {
    const backdropElement = document.createElement("div");
    backdropElement.className = "detected-text-inline-backdrop";
    const sourceBackgrounds = Array.isArray(textBlock?.sourcePreviewBackgrounds) && textBlock.sourcePreviewBackgrounds.length
      ? textBlock.sourcePreviewBackgrounds
      : [];
    backdropElement.appendChild(buildDetectedTextMaskBaseElement(textBlock, "detected-text-inline-backdrop-base"));

    if (!sourceBackgrounds.length) {
      backdropElement.classList.add("detected-text-inline-backdrop--solid");
      return backdropElement;
    }

    const originX = Number(textBlock.sourceX ?? textBlock.x ?? 0);
    const originY = Number(textBlock.sourceY ?? textBlock.y ?? 0);
    const originWidth = Math.max(Number(textBlock.sourceWidth ?? textBlock.width ?? 0.0001), 0.0001);
    const originHeight = Math.max(Number(textBlock.sourceHeight ?? textBlock.height ?? 0.0001), 0.0001);

    sourceBackgrounds.forEach(function (previewBackground, backgroundIndex) {
      const patchElement = document.createElement("div");
      patchElement.className = "detected-text-inline-backdrop-patch";
      patchElement.style.left = `${Math.max(((Number(previewBackground.x) || 0) - originX) / originWidth, 0) * 100}%`;
      patchElement.style.top = `${Math.max(((Number(previewBackground.y) || 0) - originY) / originHeight, 0) * 100}%`;
      patchElement.style.width = `${Math.max((Number(previewBackground.width) || 0) / originWidth, 0) * 100}%`;
      patchElement.style.height = `${Math.max((Number(previewBackground.height) || 0) / originHeight, 0) * 100}%`;
      patchElement.style.backgroundColor = resolveDetectedTextColor({ colorHex: previewBackground.colorHex });
      patchElement.style.opacity = `${Math.max(Math.min(Number(previewBackground.opacity) || 1, 1), 0)}`;
      patchElement.dataset.previewBackgroundIndex = String(backgroundIndex);
      backdropElement.appendChild(patchElement);
    });

    return backdropElement;
  }

  function getDetectedTextPreviewLines(textBlock) {
    return Array.isArray(textBlock?.previewLines) && textBlock.previewLines.length
      ? textBlock.previewLines
      : buildFallbackPreviewLines(textBlock);
  }

  function getDetectedTextInlineMetrics(textBlock, pageSurface) {
    const previewLines = getDetectedTextPreviewLines(textBlock);
    const renderedWidth = Math.max(getDisplayedDetectedTextWidth(textBlock, pageSurface), 1);
    const renderedHeight = Math.max(getDisplayedDetectedTextHeight(textBlock, pageSurface), 1);
    const sourceLineHeightRatio = Math.max(Number(textBlock?.lineHeightRatio) || 1.15, 1.0);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    let primaryFontName = "";
    let primaryColorHex = textBlock?.colorHex || "#0f172a";
    let primaryFontSize = Number(textBlock?.fontSize || textBlock?.renderedFontSize || 12);
    let hasMixedStyles = false;

    previewLines.forEach(function (previewLine) {
      const previewSpans = Array.isArray(previewLine?.spans) && previewLine.spans.length
        ? previewLine.spans
        : [previewLine];
      const lineTop = getDisplayedPreviewOffsetY(previewLine?.y || 0, textBlock, pageSurface);
      const lineFontSize = getDisplayedPreviewLineFontSize(previewLine, textBlock, pageSurface);
      minY = Math.min(minY, lineTop);
      maxY = Math.max(maxY, lineTop + Math.max(lineFontSize * sourceLineHeightRatio, lineFontSize));

      previewSpans.forEach(function (previewSpan, spanIndex) {
        const spanFontName = String(previewSpan?.fontName || previewLine?.fontName || textBlock?.fontName || "");
        const spanColorHex = normalizeDetectedTextColorHex(previewSpan?.colorHex || previewLine?.colorHex || textBlock?.colorHex || "#0f172a");
        const spanFontSize = getDisplayedPreviewLineFontSize(previewSpan, textBlock, pageSurface);
        const spanX = getDisplayedPreviewOffsetX(previewSpan?.x || 0, textBlock, pageSurface);
        const spanWidth = getStableDisplayedPreviewSpanWidth(previewSpan, previewLine, textBlock, pageSurface);
        minX = Math.min(minX, spanX);
        maxX = Math.max(maxX, spanX + Math.max(spanWidth, estimateRenderedTextWidth(previewSpan?.text || "", spanFontSize)));

        if (!primaryFontName && !spanIndex) {
          primaryFontName = spanFontName;
          primaryColorHex = spanColorHex;
          primaryFontSize = spanFontSize;
        } else if (
          spanFontName !== primaryFontName
          || spanColorHex.toLowerCase() !== String(primaryColorHex || "").toLowerCase()
          || Math.abs(Number(spanFontSize) - Number(primaryFontSize)) > 0.5
        ) {
          hasMixedStyles = true;
        }
      });
    });

    if (!Number.isFinite(minX)) {
      minX = 0;
    }
    if (!Number.isFinite(minY)) {
      minY = 0;
    }
    const preferredStyle = resolveDetectedTextPreferredStyle(textBlock);
    primaryFontName = String(preferredStyle?.fontName || primaryFontName || textBlock?.fontName || "");
    primaryColorHex = normalizeDetectedTextColorHex(preferredStyle?.colorHex || primaryColorHex || textBlock?.colorHex || "#0f172a");
    primaryFontSize = Number(preferredStyle?.fontSize || primaryFontSize || textBlock?.fontSize || textBlock?.renderedFontSize || 12);

    const paddingLeft = clampNumber(minX, 0, renderedWidth * 0.34);
    const paddingTop = clampNumber(minY, 0, renderedHeight * 0.28);
    const paddingRight = clampNumber(Math.max(renderedWidth - maxX, 0), 0, renderedWidth * 0.34);
    const paddingBottom = clampNumber(Math.max(renderedHeight - maxY, 0), 0, renderedHeight * 0.34);

    return {
      hasMixedStyles,
      paddingBottom,
      paddingLeft,
      paddingRight,
      paddingTop,
      primaryColorHex,
      primaryFontName,
      primaryFontSize,
      renderedHeight,
      renderedWidth
    };
  }

  function estimateRenderedTextWidth(textValue, fontSize) {
    const normalizedText = String(textValue || "");
    if (!normalizedText) {
      return 0;
    }

    return normalizedText.length * Math.max(Number(fontSize) || 12, 1) * 0.56;
  }

  function clampNumber(value, min, max) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return min;
    }

    return Math.min(Math.max(numericValue, min), max);
  }

  function buildDetectedTextInlineMetaLabel(textBlock, nextStyle, inlineMetrics) {
    const fontName = simplifyDetectedTextFontName(nextStyle.fontName || inlineMetrics.primaryFontName || textBlock?.fontName || "Document font");
    const fontSize = Math.max(Number(nextStyle.fontSize || inlineMetrics.primaryFontSize || textBlock?.fontSize || 12), 1);
    const emphasis = [];
    if (nextStyle.isBold) {
      emphasis.push("Bold");
    }
    if (nextStyle.isItalic) {
      emphasis.push("Italic");
    }

    return `${fontName} · ${fontSize.toFixed(1)} pt${emphasis.length ? ` · ${emphasis.join(" / ")}` : ""}`;
  }

  function simplifyDetectedTextFontName(fontName) {
    return String(fontName || "")
      .replace(/^[A-Z]{6}\+/i, "")
      .replace(/[-_,]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim() || "Document font";
  }

  function getDisplayedDetectedTextWidth(textBlock, pageSurface) {
    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceWidth = pageSurface?.getBoundingClientRect().width || pageSurface?.clientWidth || 0;
    if (!page || !page.width || !pageSurfaceWidth) {
      return Math.max(Number(textBlock?.width || 0) * pageSurfaceWidth, 1);
    }

    return Math.max((Number(textBlock?.width) || 0) * pageSurfaceWidth, 1);
  }

  function getDisplayedDetectedTextHeight(textBlock, pageSurface) {
    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceHeight = pageSurface?.getBoundingClientRect().height || pageSurface?.clientHeight || 0;
    if (!page || !page.height || !pageSurfaceHeight) {
      return Math.max(Number(textBlock?.height || 0) * pageSurfaceHeight, 1);
    }

    return Math.max((Number(textBlock?.height) || 0) * pageSurfaceHeight, 1);
  }

  function getDisplayedDetectedTextFontSize(textBlock, pageSurface) {
    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceHeight = pageSurface?.getBoundingClientRect().height || pageSurface?.clientHeight || 0;
    if (!page || !page.height || !pageSurfaceHeight) {
      return Math.max(Number(textBlock.renderedFontSize) || Number(textBlock.fontSize) || 12, 8);
    }

    return Math.max(((Number(textBlock.renderedFontSize) || Number(textBlock.fontSize) || 12) / Number(page.height)) * pageSurfaceHeight, 8);
  }

  function getDisplayedPreviewLineFontSize(previewLine, textBlock, pageSurface) {
    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      const renderedHeight = Math.max(getDisplayedDetectedTextHeight(textBlock, pageSurface), 1);
      const previewViewportHeight = Math.max(getDetectedTextPreviewViewportHeight(textBlock), 1);
      return Math.max(((Number(previewLine?.fontSize) || Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12) / previewViewportHeight) * renderedHeight, 1);
    }

    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceHeight = pageSurface?.getBoundingClientRect().height || pageSurface?.clientHeight || 0;
    if (!page || !page.height || !pageSurfaceHeight) {
      return Math.max(Number(previewLine?.fontSize) || Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12, 8);
    }

    return Math.max(((Number(previewLine?.fontSize) || Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12) / Number(page.height)) * pageSurfaceHeight, 8);
  }

  function getDisplayedPreviewOffsetX(offsetValue, textBlock, pageSurface) {
    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      const renderedWidth = Math.max(getDisplayedDetectedTextWidth(textBlock, pageSurface), 1);
      const previewViewportWidth = Math.max(getDetectedTextPreviewViewportWidth(textBlock), 1);
      return Math.max(((Number(offsetValue) || 0) / previewViewportWidth) * renderedWidth, 0);
    }

    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceWidth = pageSurface?.getBoundingClientRect().width || pageSurface?.clientWidth || 0;
    if (!page || !page.width || !pageSurfaceWidth) {
      return Math.max(Number(offsetValue) || 0, 0);
    }

    return Math.max(((Number(offsetValue) || 0) / Number(page.width)) * pageSurfaceWidth, 0);
  }

  function getDisplayedPreviewSpanWidth(previewSpan, previewLine, textBlock, pageSurface) {
    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      const explicitWidth = Number(previewSpan?.width);
      if (explicitWidth > 0) {
        const renderedWidth = Math.max(getDisplayedDetectedTextWidth(textBlock, pageSurface), 1);
        const previewViewportWidth = Math.max(getDetectedTextPreviewViewportWidth(textBlock), 1);
        return Math.max((explicitWidth / previewViewportWidth) * renderedWidth, 0);
      }
    }

    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceWidth = pageSurface?.getBoundingClientRect().width || pageSurface?.clientWidth || 0;
    const explicitWidth = Number(previewSpan?.width);
    if (page && page.width && pageSurfaceWidth && explicitWidth > 0) {
      return Math.max((explicitWidth / Number(page.width)) * pageSurfaceWidth, 0);
    }

    const spanFontSize = getDisplayedPreviewLineFontSize(previewSpan || previewLine, textBlock, pageSurface);
    return estimateRenderedTextWidth(previewSpan?.text || previewLine?.text || "", spanFontSize);
  }

  function getStableDisplayedPreviewSpanWidth(previewSpan, previewLine, textBlock, pageSurface) {
    const explicitWidth = getDisplayedPreviewSpanWidth(previewSpan, previewLine, textBlock, pageSurface);
    if (!(explicitWidth > 0)) {
      return explicitWidth;
    }

    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      return explicitWidth;
    }

    // Give the browser a tiny amount of slack so drag/move redraws do not
    // visually compress the glyphs when SVG textLength is applied.
    return explicitWidth * 1.012;
  }

  function getDisplayedPreviewOffsetY(offsetValue, textBlock, pageSurface) {
    if (getDetectedTextPreviewCoordinateSpace(textBlock) === "exact-local") {
      const renderedHeight = Math.max(getDisplayedDetectedTextHeight(textBlock, pageSurface), 1);
      const previewViewportHeight = Math.max(getDetectedTextPreviewViewportHeight(textBlock), 1);
      return Math.max(((Number(offsetValue) || 0) / previewViewportHeight) * renderedHeight, 0);
    }

    const page = editorTextState.pages.find(function (candidatePage) {
      return candidatePage.pageNumber === textBlock.pageNumber;
    });
    const pageSurfaceHeight = pageSurface?.getBoundingClientRect().height || pageSurface?.clientHeight || 0;
    if (!page || !page.height || !pageSurfaceHeight) {
      return Math.max(Number(offsetValue) || 0, 0);
    }

    return Math.max(((Number(offsetValue) || 0) / Number(page.height)) * pageSurfaceHeight, 0);
  }

  function buildFallbackPreviewLines(textBlock) {
    const layoutLines = Array.isArray(textBlock?.layoutLines) && textBlock.layoutLines.length
      ? textBlock.layoutLines
      : String(textBlock?.text || "").split(/\r?\n/);
    const lineHeightOffset = Math.max(Number(textBlock?.lineHeightRatio) || 1.15, 1.0) * (Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12);
    return layoutLines.map(function (lineText, index) {
      const fontSize = Number(textBlock?.renderedFontSize) || Number(textBlock?.fontSize) || 12;
      const topOffset = index * lineHeightOffset;
      return {
        text: lineText,
        x: 0,
        y: topOffset,
        baselineY: topOffset + fontSize,
        fontSize: fontSize,
        fontName: textBlock?.fontName || "",
        colorHex: textBlock?.colorHex || "#000000",
        isBold: !!textBlock?.isBold,
        isItalic: !!textBlock?.isItalic,
        spans: [
          {
            text: lineText,
            x: 0,
            fontSize: fontSize,
            fontName: textBlock?.fontName || "",
            colorHex: textBlock?.colorHex || "#000000",
            isBold: !!textBlock?.isBold,
            isItalic: !!textBlock?.isItalic
          }
        ]
      };
    });
  }

  function mapPdfFontNameToCss(fontName, textBlock, fontLike) {
    const exactDescriptor = buildDetectedTextFontDescriptor(textBlock, fontLike || { fontName: fontName });
    const exactKey = buildDetectedTextFontResourceKey(exactDescriptor);
    const exactFamily = exactKey ? editorTextState.exactFontFamilies.get(exactKey) : "";
    if (exactFamily) {
      return `"${exactFamily}", ${mapPdfFontNameToFallbackCss(fontName)}`;
    }

    if (textBlock && exactDescriptor.fontName) {
      void ensureDetectedTextFontResource(textBlock, exactDescriptor);
    }

    return mapPdfFontNameToFallbackCss(fontName);
  }

  function mapPdfFontNameToFallbackCss(fontName) {
    const normalizedFontName = String(fontName || "").toLowerCase();
    if (normalizedFontName.includes("cambria")) {
      return "\"Cambria\", \"Times New Roman\", Georgia, serif";
    }

    if (normalizedFontName.includes("calibri")) {
      return "\"Calibri\", \"Segoe UI\", Arial, sans-serif";
    }

    if (normalizedFontName.includes("arial") || normalizedFontName.includes("helvetica")) {
      return "Arial, Helvetica, sans-serif";
    }

    if (normalizedFontName.includes("verdana")) {
      return "Verdana, Geneva, sans-serif";
    }

    if (normalizedFontName.includes("tahoma")) {
      return "Tahoma, \"Segoe UI\", sans-serif";
    }

    if (normalizedFontName.includes("trebuchet")) {
      return "\"Trebuchet MS\", Arial, sans-serif";
    }

    if (normalizedFontName.includes("georgia")) {
      return "Georgia, \"Times New Roman\", serif";
    }

    if (normalizedFontName.includes("garamond")) {
      return "\"Garamond\", Georgia, serif";
    }

    if (normalizedFontName.includes("times") || normalizedFontName.includes("roman") || normalizedFontName.includes("serif")) {
      return "\"Times New Roman\", Georgia, serif";
    }

    if (normalizedFontName.includes("courier") || normalizedFontName.includes("mono")) {
      return "\"Courier New\", monospace";
    }

    return "Helvetica, Arial, sans-serif";
  }

  function resolveDetectedTextColor(textBlock) {
    const colorHex = String(textBlock?.colorHex || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(colorHex)) {
      return colorHex;
    }

    return "#0f172a";
  }

  function resolveDetectedTextFontWeight(textBlock) {
    if (textBlock?.isBold) {
      return "700";
    }

    const normalizedFontName = String(textBlock?.fontName || "").toLowerCase();
    return /(bold|black|semibold|demi)/.test(normalizedFontName) ? "700" : "400";
  }

  function resolveDetectedTextFontStyle(textBlock) {
    if (textBlock?.isItalic) {
      return "italic";
    }

    const normalizedFontName = String(textBlock?.fontName || "").toLowerCase();
    return /(italic|oblique)/.test(normalizedFontName) ? "italic" : "normal";
  }

  function applyDetectedTextStyleToInlineEditor(textareaElement, textBlock, pageSurface) {
    if (!textareaElement || !textBlock) {
      return;
    }

    const nextStyle = getPendingDetectedTextStyle(textBlock);
    const inlineMetrics = getDetectedTextInlineMetrics(textBlock, pageSurface);
    const renderedFontSize = getDisplayedPreviewLineFontSize({ fontSize: nextStyle.fontSize }, textBlock, pageSurface);
    const lineHeightRatio = Math.max(Number(textBlock?.lineHeightRatio) || 1.15, 1.0);
    const safetyInset = 2;
    textareaElement.style.color = resolveDetectedTextColor({ colorHex: nextStyle.colorHex });
    textareaElement.style.fontFamily = mapPdfFontNameToCss(nextStyle.fontName || textBlock.fontName, textBlock, nextStyle);
    textareaElement.style.fontSize = `${renderedFontSize}px`;
    textareaElement.style.fontWeight = nextStyle.isBold ? "700" : resolveDetectedTextFontWeight({ fontName: nextStyle.fontName });
    textareaElement.style.fontStyle = nextStyle.isItalic ? "italic" : resolveDetectedTextFontStyle({ fontName: nextStyle.fontName });
    textareaElement.style.lineHeight = `${Math.max(renderedFontSize * lineHeightRatio, renderedFontSize)}px`;
    textareaElement.style.left = `${-safetyInset}px`;
    textareaElement.style.top = `${-safetyInset}px`;
    textareaElement.style.right = "auto";
    textareaElement.style.bottom = "auto";
    textareaElement.style.width = `calc(100% + ${safetyInset * 2}px)`;
    textareaElement.style.height = `calc(100% + ${safetyInset * 2}px)`;
    textareaElement.style.paddingTop = `${inlineMetrics.paddingTop}px`;
    textareaElement.style.paddingRight = `${inlineMetrics.paddingRight}px`;
    textareaElement.style.paddingBottom = `${inlineMetrics.paddingBottom}px`;
    textareaElement.style.paddingLeft = `${inlineMetrics.paddingLeft}px`;
  }

  function syncDetectedTextInlineEditorStyle() {
    const selectedTextBlock = getSelectedDetectedTextBlock();
    if (!selectedTextBlock || editorTextState.editingTextBlockId !== getDetectedTextSelectionId(selectedTextBlock)) {
      return;
    }

    getEditPdfViewer()
      .then(function (viewer) {
        const pageSurface = viewer?.getPageSurfaceElement(selectedTextBlock.pageNumber);
        const inlineTextarea = document.querySelector(`.detected-text-inline-editor[data-text-block-id="${getDetectedTextSelectionId(selectedTextBlock)}"]`);
        if (!inlineTextarea || !pageSurface) {
          return;
        }

        applyDetectedTextStyleToInlineEditor(inlineTextarea, selectedTextBlock, pageSurface);
        syncDetectedTextInlineToolbar(selectedTextBlock, pageSurface);
      })
      .catch(function () {
      });
  }

  function syncDetectedTextInlineToolbar(textBlock, pageSurface) {
    const selectionId = getDetectedTextSelectionId(textBlock);
    const toolbarElement = document.querySelector(`.detected-text-inline-toolbar[data-text-block-id="${selectionId}"]`);
    if (!toolbarElement) {
      return;
    }

    const nextStyle = getPendingDetectedTextStyle(textBlock);
    const inlineMetrics = getDetectedTextInlineMetrics(textBlock, pageSurface);
    const swatchElement = toolbarElement.querySelector(".detected-text-inline-swatch");
    const metaElement = toolbarElement.querySelector(".detected-text-inline-meta");
    const mixedBadgeElement = toolbarElement.querySelector(".detected-text-inline-badge");

    if (swatchElement) {
      swatchElement.style.backgroundColor = resolveDetectedTextColor({ colorHex: nextStyle.colorHex || inlineMetrics.primaryColorHex });
    }

    if (metaElement) {
      metaElement.textContent = buildDetectedTextInlineMetaLabel(textBlock, nextStyle, inlineMetrics);
    }

    if (mixedBadgeElement) {
      mixedBadgeElement.hidden = !inlineMetrics.hasMixedStyles;
    }
  }

  function buildDetectedTextTransformHandle(handleName) {
    const handleElement = document.createElement("button");
    handleElement.type = "button";
    handleElement.className = `detected-text-handle detected-text-handle--${handleName}`;
    if (handleName !== "move") {
      handleElement.dataset.resizeHandle = handleName;
      handleElement.setAttribute("aria-label", `Resize selected text from the ${handleName.replace("-", " ")} corner`);
    } else {
      handleElement.dataset.moveHandle = "true";
      handleElement.setAttribute("aria-label", "Move selected text");
    }
    return handleElement;
  }

  function getDetectedTextPreviewBounds(textBlock) {
    const interaction = editorTextState.dragInteraction;
    if (!interaction || interaction.textBlockId !== getDetectedTextSelectionId(textBlock)) {
      return getDisplayedDetectedTextBounds(textBlock);
    }

    return interaction.currentBounds || interaction.originalDisplayedBounds;
  }

  function getDisplayedDetectedTextBounds(textBlock) {
    if (getDetectedTextPreviewMode(textBlock) === "preserved-source") {
      const renderTextBlock = getPreservedSourceRenderTextBlock(textBlock);
      return {
        ...textBlock,
        width: renderTextBlock.width,
        height: renderTextBlock.height
      };
    }

    return textBlock;
  }

  function getTextLayerHighlightBounds(textBlock) {
    if (!textBlock || !editorTextState.selectedViewerSelection) {
      return null;
    }

    const viewerSelection = editorTextState.selectedViewerSelection;
    const selectedText = normalizeClipboardTextValue(textBlock.text);
    const viewerSelectedText = normalizeClipboardTextValue(viewerSelection.text);

    if (!viewerSelectedText || viewerSelection.pageNumber !== textBlock.pageNumber) {
      return null;
    }

    if (!selectedText || !selectedText.includes(viewerSelectedText)) {
      return null;
    }

    return viewerSelection.bounds || null;
  }

  function handleDetectedTextBlockSelectionPointerDown(event, textBlock, element) {
    closeEditorContextMenu();

    if (!currentEditSession || editorAnnotationState.activeTool !== "select") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearViewerTextSelection();
    editorAnnotationState.selectedAnnotationId = "";
    setEditorPlacementAnchor(
      textBlock.pageNumber,
      getNormalizedPoint(event, element.parentElement.getBoundingClientRect())
    );
    selectDetectedTextBlock(getDetectedTextSelectionId(textBlock), false);
  }

  function mapDisplayedBoundsToSourceBounds(displayedBounds, dragInteraction) {
    if (!displayedBounds || !dragInteraction) {
      return null;
    }

    const sourceBounds = dragInteraction.originalSourceBounds;
    const displayedSourceBounds = dragInteraction.originalDisplayedBounds;
    if (!sourceBounds || !displayedSourceBounds) {
      return displayedBounds;
    }

    const widthRatio = displayedBounds.width / Math.max(displayedSourceBounds.width, 0.0001);
    const heightRatio = displayedBounds.height / Math.max(displayedSourceBounds.height, 0.0001);
    const deltaX = displayedBounds.x - displayedSourceBounds.x;
    const deltaY = displayedBounds.y - displayedSourceBounds.y;

    return {
      height: clamp(sourceBounds.height * heightRatio, 0.02, 1),
      width: clamp(sourceBounds.width * widthRatio, 0.02, 1),
      x: clamp(sourceBounds.x + deltaX, 0, 1),
      y: clamp(sourceBounds.y + deltaY, 0, 1)
    };
  }

  function clampSourceBounds(bounds) {
    if (!bounds) {
      return null;
    }

    const width = clamp(bounds.width, 0.02, 1);
    const height = clamp(bounds.height, 0.02, 1);
    return {
      width,
      height,
      x: clamp(bounds.x, 0, Math.max(1 - width, 0)),
      y: clamp(bounds.y, 0, Math.max(1 - height, 0))
    };
  }

  function resizeDisplayedBounds(bounds, handleName, deltaX, deltaY) {
    if (!bounds) {
      return null;
    }

    let nextX = bounds.x;
    let nextY = bounds.y;
    let nextWidth = bounds.width;
    let nextHeight = bounds.height;

    if (handleName.includes("left")) {
      nextX = clamp(bounds.x + deltaX, 0, bounds.x + bounds.width - 0.02);
      nextWidth = bounds.width - (nextX - bounds.x);
    } else if (handleName.includes("right")) {
      nextWidth = clamp(bounds.width + deltaX, 0.02, 1 - bounds.x);
    }

    if (handleName.includes("top")) {
      nextY = clamp(bounds.y + deltaY, 0, bounds.y + bounds.height - 0.02);
      nextHeight = bounds.height - (nextY - bounds.y);
    } else if (handleName.includes("bottom")) {
      nextHeight = clamp(bounds.height + deltaY, 0.02, 1 - bounds.y);
    }

    return {
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight
    };
  }

  function handleDetectedTextPointerDown(event, textBlock, element) {
    closeEditorContextMenu();

    if (!currentEditSession || editorAnnotationState.activeTool !== "select") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearViewerTextSelection();
    setEditorPlacementAnchor(textBlock.pageNumber, getNormalizedPoint(event, element.parentElement.getBoundingClientRect()));
    const resizeHandle = event.target.closest("[data-resize-handle]");
    const originalDisplayedBounds = getDisplayedDetectedTextBounds(textBlock);

    if (typeof element.setPointerCapture === "function") {
      try {
        element.setPointerCapture(event.pointerId);
      } catch (_error) {
      }
    }

    editorTextState.dragInteraction = {
      activeElement: element,
      bounds: element.parentElement.getBoundingClientRect(),
      currentPoint: getNormalizedPoint(event, element.parentElement.getBoundingClientRect()),
      currentBounds: { ...originalDisplayedBounds },
      originalDisplayedBounds: { ...originalDisplayedBounds },
      originalSourceBounds: {
        x: textBlock.x,
        y: textBlock.y,
        width: textBlock.width,
        height: textBlock.height
      },
      pageSurface: element.closest(".pdfjs-page-surface"),
      pointerId: event.pointerId,
      resizeHandle: resizeHandle ? resizeHandle.dataset.resizeHandle : "",
      startPoint: getNormalizedPoint(event, element.parentElement.getBoundingClientRect()),
      textBlock: textBlock,
      textBlockId: getDetectedTextSelectionId(textBlock),
      transformKind: resizeHandle ? "resize" : "move",
      moved: false
    };

    editorTextState.selectedTextBlockId = getDetectedTextSelectionId(textBlock);
    editorAnnotationState.selectedAnnotationId = "";
    updateEditorAnnotationControls();
    renderEditorAnnotations();
  }

  function handleDetectedTextPointerMove(event) {
    const interaction = editorTextState.dragInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    interaction.currentPoint = getNormalizedPoint(event, interaction.bounds);
    const deltaX = interaction.currentPoint.x - interaction.startPoint.x;
    const deltaY = interaction.currentPoint.y - interaction.startPoint.y;
    if (Math.abs(deltaX) > 0.003 || Math.abs(deltaY) > 0.003) {
      interaction.moved = true;
    }

    if (interaction.transformKind === "resize") {
      interaction.currentBounds = resizeDisplayedBounds(interaction.originalDisplayedBounds, interaction.resizeHandle, deltaX, deltaY);
    } else {
      interaction.currentBounds = {
        x: clamp(interaction.originalDisplayedBounds.x + deltaX, 0, 1 - interaction.originalDisplayedBounds.width),
        y: clamp(interaction.originalDisplayedBounds.y + deltaY, 0, 1 - interaction.originalDisplayedBounds.height),
        width: interaction.originalDisplayedBounds.width,
        height: interaction.originalDisplayedBounds.height
      };
    }

    applyDetectedTextPreviewToElement(interaction.activeElement, interaction.currentBounds, interaction.pageSurface, interaction.textBlock);
  }

  async function handleDetectedTextPointerUp(event) {
    const interaction = editorTextState.dragInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    if (interaction.activeElement && typeof interaction.activeElement.releasePointerCapture === "function") {
      try {
        interaction.activeElement.releasePointerCapture(event.pointerId);
      } catch (_error) {
      }
    }

    const textBlock = findDetectedTextBlock(interaction.textBlockId);
    const finalDisplayedBounds = interaction.currentBounds || interaction.originalDisplayedBounds;
    editorTextState.dragInteraction = null;
    renderDetectedTextBlocks();

    if (!textBlock || !finalDisplayedBounds || !interaction.moved) {
      return;
    }

    const mappedSourceBounds = clampSourceBounds(mapDisplayedBoundsToSourceBounds(finalDisplayedBounds, interaction));
    if (!mappedSourceBounds) {
      return;
    }

    if (interaction.transformKind === "move" && interaction.originalSourceBounds) {
      mappedSourceBounds.width = interaction.originalSourceBounds.width;
      mappedSourceBounds.height = interaction.originalSourceBounds.height;
      mappedSourceBounds.x = clamp(mappedSourceBounds.x, 0, Math.max(1 - mappedSourceBounds.width, 0));
      mappedSourceBounds.y = clamp(mappedSourceBounds.y, 0, Math.max(1 - mappedSourceBounds.height, 0));
    }

    clearViewerTextSelection();
    await applyDetectedTextLayoutUpdate(textBlock, mappedSourceBounds, false);
  }

  async function copySelectedDetectedTextBlock() {
    const viewerSelection = getActiveViewerTextSelection() || editorTextState.selectedViewerSelection;
    if (viewerSelection?.text) {
      const selectedTextBlock = getSelectedDetectedTextBlock();
      const normalizedSelectionText = normalizeClipboardTextValue(viewerSelection.text);
      if (
        selectedTextBlock &&
        normalizeClipboardTextValue(selectedTextBlock.text) === normalizedSelectionText
      ) {
        editorTextState.clipboardTextBlock = { ...selectedTextBlock };
        await writeDetectedTextBlockToClipboard(selectedTextBlock);
      } else {
        editorTextState.clipboardTextBlock = null;
        await writeTextToClipboard(normalizedSelectionText);
      }

      setStatus(editorTextState.statusElement, "Copied the selected PDF text.", false);
      return;
    }

    const selectedTextBlock = getSelectedDetectedTextBlock();
    if (!selectedTextBlock) {
      setStatus(editorTextState.statusElement, "Select detected PDF text before copying it.", true);
      return;
    }

    editorTextState.clipboardTextBlock = { ...selectedTextBlock };
    await writeDetectedTextBlockToClipboard(selectedTextBlock);
    setStatus(editorTextState.statusElement, "Copied the selected text block to the clipboard.", false);
  }

  async function pasteClipboardIntoEditor(statusElement, pasteEvent) {
    const toolSessionId = requireEditToolSession(statusElement);
    if (!toolSessionId) {
      return;
    }

    const clipboardPayload = pasteEvent
      ? await readClipboardPayloadFromPasteEvent(pasteEvent)
      : await readClipboardPayloadFromSystemClipboard();

    if (!clipboardPayload) {
      setStatus(editorTextState.statusElement, "Copy text, a link, or an image before pasting into the PDF.", true);
      return;
    }

    if (clipboardPayload.kind === "detected-text-block") {
      editorTextState.clipboardTextBlock = { ...clipboardPayload.textBlock };
      await pasteCopiedDetectedTextBlock(statusElement, clipboardPayload.textBlock);
      return;
    }

    if (clipboardPayload.kind === "image") {
      await addClipboardImageObject(clipboardPayload, statusElement);
      return;
    }

    if (clipboardPayload.kind === "url") {
      addClipboardLinkObject(clipboardPayload, statusElement);
      return;
    }

    if (clipboardPayload.kind === "text") {
      addClipboardTextObject(clipboardPayload, statusElement);
      return;
    }
  }

  async function pasteCopiedDetectedTextBlock(statusElement, sourceTextBlockOverride) {
    const toolSessionId = requireEditToolSession(statusElement);
    const sourceTextBlock = sourceTextBlockOverride || editorTextState.clipboardTextBlock || getSelectedDetectedTextBlock();

    if (!toolSessionId) {
      return;
    }

    if (!sourceTextBlock) {
      setStatus(editorTextState.statusElement, "Copy a text block before pasting it.", true);
      return;
    }

    const duplicatedBounds = buildDuplicateTextBounds(sourceTextBlock);

    await applyDetectedTextLayoutUpdate(sourceTextBlock, duplicatedBounds, true);
  }

  function buildDuplicateTextBounds(sourceTextBlock) {
    if (editorContextMenuState.anchorPageNumber === sourceTextBlock.pageNumber && editorContextMenuState.anchorPoint) {
      const anchoredX = clamp(
        editorContextMenuState.anchorPoint.x - sourceTextBlock.width / 2,
        0,
        Math.max(1 - sourceTextBlock.width, 0)
      );
      const anchoredY = clamp(
        editorContextMenuState.anchorPoint.y - Math.min(sourceTextBlock.height / 2, 0.04),
        0,
        Math.max(1 - sourceTextBlock.height, 0)
      );

      if (Math.abs(anchoredX - sourceTextBlock.x) > 0.001 || Math.abs(anchoredY - sourceTextBlock.y) > 0.001) {
        return {
          x: anchoredX,
          y: anchoredY,
          width: sourceTextBlock.width,
          height: sourceTextBlock.height
        };
      }
    }

    const horizontalRoom = Math.max(1 - sourceTextBlock.width, 0);
    const verticalRoom = Math.max(1 - sourceTextBlock.height, 0);
    const offsets = [
      { x: 0.02, y: 0.02 },
      { x: -0.02, y: 0.02 },
      { x: 0.02, y: -0.02 },
      { x: -0.02, y: -0.02 },
      { x: 0.04, y: 0.015 }
    ];

    for (const offset of offsets) {
      const candidateX = clamp(sourceTextBlock.x + offset.x, 0, horizontalRoom);
      const candidateY = clamp(sourceTextBlock.y + offset.y, 0, verticalRoom);
      if (Math.abs(candidateX - sourceTextBlock.x) > 0.001 || Math.abs(candidateY - sourceTextBlock.y) > 0.001) {
        return {
          x: candidateX,
          y: candidateY,
          width: sourceTextBlock.width,
          height: sourceTextBlock.height
        };
      }
    }

    return {
      x: clamp(Math.max(sourceTextBlock.x - 0.03, 0), 0, horizontalRoom),
      y: clamp(Math.max(sourceTextBlock.y - 0.03, 0), 0, verticalRoom),
      width: sourceTextBlock.width,
      height: sourceTextBlock.height
    };
  }

  function setEditorPlacementAnchor(pageNumber, point) {
    editorContextMenuState.anchorPageNumber = Math.max(Number(pageNumber) || editorAnnotationState.activePageNumber || 1, 1);
    editorContextMenuState.anchorPoint = {
      x: clamp(Number(point?.x) || 0.18, 0.02, 0.98),
      y: clamp(Number(point?.y) || 0.18, 0.02, 0.98)
    };
  }

  function setEditorPlacementAnchorFromEvent(surfaceElement, event, pageNumberOverride) {
    if (!surfaceElement || !event) {
      return;
    }

    const pageNumber = Number(pageNumberOverride) || Number(surfaceElement.closest("[data-page-number]")?.dataset.pageNumber || editorAnnotationState.activePageNumber || 1);
    setEditorPlacementAnchor(pageNumber, getNormalizedPoint(event, surfaceElement.getBoundingClientRect()));
  }

  function isEditableInputTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  async function writeDetectedTextBlockToClipboard(textBlock) {
    if (!textBlock || !navigator.clipboard) {
      return;
    }

    const serializedTextBlock = JSON.stringify({
      textObjectId: textBlock.textObjectId || "",
      textBlockId: textBlock.textBlockId,
      pageNumber: textBlock.pageNumber,
      text: textBlock.text,
      x: textBlock.x,
      y: textBlock.y,
      width: textBlock.width,
      height: textBlock.height,
      fontName: textBlock.fontName,
      fontSize: textBlock.fontSize,
      colorHex: textBlock.colorHex || "#000000",
      isBold: !!textBlock.isBold,
      isItalic: !!textBlock.isItalic
    });

    if (navigator.clipboard.write && window.ClipboardItem) {
      try {
        const clipboardItem = new ClipboardItem({
          "text/plain": new Blob([textBlock.text || ""], { type: "text/plain" }),
          [EDITOR_TEXT_BLOCK_CLIPBOARD_MIME]: new Blob([serializedTextBlock], { type: EDITOR_TEXT_BLOCK_CLIPBOARD_MIME })
        });
        await navigator.clipboard.write([clipboardItem]);
        return;
      } catch (_error) {
      }
    }

    if (navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(textBlock.text || "");
      } catch (_error) {
      }
    }
  }

  async function writeTextToClipboard(value) {
    if (!value || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
    }
  }

  async function readClipboardPayloadFromPasteEvent(event) {
    const clipboardData = event?.clipboardData;
    if (!clipboardData) {
      return editorTextState.clipboardTextBlock
        ? { kind: "detected-text-block", textBlock: { ...editorTextState.clipboardTextBlock } }
        : null;
    }

    const serializedTextBlock = clipboardData.getData(EDITOR_TEXT_BLOCK_CLIPBOARD_MIME);
    const parsedTextBlock = parseDetectedTextBlockClipboard(serializedTextBlock);
    if (parsedTextBlock) {
      return { kind: "detected-text-block", textBlock: parsedTextBlock };
    }

    const imageItem = Array.from(clipboardData.items || []).find(function (item) {
      return item.kind === "file" && item.type.startsWith("image/");
    });
    if (imageItem) {
      const imageFile = imageItem.getAsFile();
      if (imageFile) {
        return {
          kind: "image",
          dataUrl: await readFileAsDataUrl(imageFile),
          fileName: imageFile.name || "Pasted image"
        };
      }
    }

    const uriList = (clipboardData.getData("text/uri-list") || "")
      .split(/\r?\n/)
      .map(function (value) { return value.trim(); })
      .find(function (value) { return value && !value.startsWith("#"); });
    if (isSupportedClipboardUrl(uriList)) {
      return {
        kind: "url",
        label: buildClipboardLinkLabel(uriList),
        url: uriList
      };
    }

    return buildClipboardPayloadFromPlainText(clipboardData.getData("text/plain") || "");
  }

  async function readClipboardPayloadFromSystemClipboard() {
    if (navigator.clipboard?.read) {
      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const clipboardItem of clipboardItems) {
          if (clipboardItem.types.includes(EDITOR_TEXT_BLOCK_CLIPBOARD_MIME)) {
            const textBlockBlob = await clipboardItem.getType(EDITOR_TEXT_BLOCK_CLIPBOARD_MIME);
            const parsedTextBlock = parseDetectedTextBlockClipboard(await textBlockBlob.text());
            if (parsedTextBlock) {
              return { kind: "detected-text-block", textBlock: parsedTextBlock };
            }
          }

          const imageType = clipboardItem.types.find(function (type) {
            return type.startsWith("image/");
          });
          if (imageType) {
            const imageBlob = await clipboardItem.getType(imageType);
            return {
              kind: "image",
              dataUrl: await readFileAsDataUrl(imageBlob),
              fileName: `Pasted image.${imageType.split("/")[1] || "png"}`
            };
          }

          if (clipboardItem.types.includes("text/uri-list")) {
            const uriBlob = await clipboardItem.getType("text/uri-list");
            const uriList = (await uriBlob.text())
              .split(/\r?\n/)
              .map(function (value) { return value.trim(); })
              .find(function (value) { return value && !value.startsWith("#"); });
            if (isSupportedClipboardUrl(uriList)) {
              return {
                kind: "url",
                label: buildClipboardLinkLabel(uriList),
                url: uriList
              };
            }
          }

          if (clipboardItem.types.includes("text/plain")) {
            const textBlob = await clipboardItem.getType("text/plain");
            const payload = buildClipboardPayloadFromPlainText(await textBlob.text());
            if (payload) {
              return payload;
            }
          }
        }
      } catch (_error) {
      }
    }

    if (navigator.clipboard?.readText) {
      try {
        const payload = buildClipboardPayloadFromPlainText(await navigator.clipboard.readText());
        if (payload) {
          return payload;
        }
      } catch (_error) {
      }
    }

    return editorTextState.clipboardTextBlock
      ? { kind: "detected-text-block", textBlock: { ...editorTextState.clipboardTextBlock } }
      : null;
  }

  function parseDetectedTextBlockClipboard(serializedTextBlock) {
    if (!serializedTextBlock) {
      return null;
    }

    try {
      const textBlock = JSON.parse(serializedTextBlock);
      if (!textBlock || typeof textBlock !== "object" || !textBlock.textBlockId || !textBlock.text) {
        return null;
      }

      return {
        colorHex: textBlock.colorHex || "#000000",
        fontName: textBlock.fontName || "",
        fontSize: Number(textBlock.fontSize) || 12,
        height: Number(textBlock.height) || 0.08,
        isBold: !!textBlock.isBold,
        isItalic: !!textBlock.isItalic,
        pageNumber: Number(textBlock.pageNumber) || 1,
        text: String(textBlock.text || ""),
        textObjectId: String(textBlock.textObjectId || ""),
        textBlockId: String(textBlock.textBlockId || ""),
        width: Number(textBlock.width) || 0.2,
        x: Number(textBlock.x) || 0,
        y: Number(textBlock.y) || 0
      };
    } catch (_error) {
      return null;
    }
  }

  function buildClipboardPayloadFromPlainText(value) {
    const normalizedText = normalizeClipboardTextValue(value);
    if (!normalizedText) {
      return null;
    }

    if (
      editorTextState.clipboardTextBlock &&
      normalizeClipboardTextValue(editorTextState.clipboardTextBlock.text) === normalizedText
    ) {
      return {
        kind: "detected-text-block",
        textBlock: { ...editorTextState.clipboardTextBlock }
      };
    }

    if (isSupportedClipboardUrl(normalizedText)) {
      return {
        kind: "url",
        label: buildClipboardLinkLabel(normalizedText),
        url: normalizedText
      };
    }

    return {
      kind: "text",
      text: normalizedText
    };
  }

  function normalizeClipboardTextValue(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function normalizeEditableTextValue(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function normalizeEditableTextForComparison(value) {
    return normalizeEditableTextValue(value)
      .split("\n")
      .map(function (line) {
        return line.replace(/[ \t\f\v]+/g, " ").trimEnd();
      })
      .join("\n")
      .trimEnd();
  }

  function shouldExpectPreservedSourcePreviewMode(textBlock, nextBounds, nextStyle, nextText) {
    if (!textBlock || !nextBounds || !nextStyle) {
      return false;
    }

    const fontSizeTolerance = 0.05;
    const sizeTolerance = 0.0025;
    const normalizedNextText = normalizeClipboardTextValue(nextText ?? textBlock.text);
    const normalizedSourceText = normalizeClipboardTextValue(textBlock.sourceText || textBlock.text);
    const sourceWidth = Number(textBlock.sourceWidth) || Number(textBlock.width) || 0;
    const sourceHeight = Number(textBlock.sourceHeight) || Number(textBlock.height) || 0;
    const sourceFontSize = Number(textBlock.sourceFontSize) || Number(textBlock.fontSize) || Number(textBlock.renderedFontSize) || 12;
    const sourceFontName = String(textBlock.sourceFontName || textBlock.fontName || "");
    const sourceColorHex = normalizeDetectedTextColorHex(textBlock.sourceColorHex || textBlock.colorHex || "#0f172a");
    const sourceIsBold = typeof textBlock.sourceIsBold === "boolean" ? textBlock.sourceIsBold : !!textBlock.isBold;
    const sourceIsItalic = typeof textBlock.sourceIsItalic === "boolean" ? textBlock.sourceIsItalic : !!textBlock.isItalic;

    return normalizedNextText === normalizedSourceText
      && String(nextStyle.fontName || "").trim().toLowerCase() === sourceFontName.trim().toLowerCase()
      && Math.abs(Number(nextStyle.fontSize || 0) - sourceFontSize) < fontSizeTolerance
      && normalizeDetectedTextColorHex(nextStyle.colorHex || "#0f172a").toLowerCase() === sourceColorHex.toLowerCase()
      && !!nextStyle.isBold === sourceIsBold
      && !!nextStyle.isItalic === sourceIsItalic
      && Math.abs((Number(nextBounds.width) || 0) - sourceWidth) < sizeTolerance
      && Math.abs((Number(nextBounds.height) || 0) - sourceHeight) < sizeTolerance;
  }

  function getActiveViewerTextSelection() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const targetNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
    const activeTextLayer = targetNode instanceof Element
      ? targetNode.closest(".pdfjs-text-layer")
      : null;

    if (!activeTextLayer || !isNodeInsideElement(range.commonAncestorContainer, activeTextLayer)) {
      return null;
    }

    const text = normalizeClipboardTextValue(selection.toString());
    return text ? { text } : null;
  }

  function isSupportedClipboardUrl(value) {
    if (!value) {
      return false;
    }

    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function buildClipboardLinkLabel(url) {
    return String(url || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "") || "Open link";
  }

  function buildClipboardObjectPlacement(width, height, pageNumberOverride) {
    const pageCount = Math.max(Number(currentEditSession?.pageCount) || 0, 1);
    const pageNumber = clamp(
      Number(pageNumberOverride) || editorContextMenuState.anchorPageNumber || editorAnnotationState.activePageNumber || 1,
      1,
      pageCount
    );
    const anchorPoint = editorContextMenuState.anchorPoint || { x: 0.18, y: 0.18 };
    const maxX = Math.max(1 - width - 0.02, 0.02);
    const maxY = Math.max(1 - height - 0.02, 0.02);

    return {
      height: height,
      pageNumber: pageNumber,
      width: width,
      x: clamp(anchorPoint.x - width / 2, 0.02, maxX),
      y: clamp(anchorPoint.y - Math.min(height / 2, 0.04), 0.02, maxY)
    };
  }

  function addClipboardTextObject(clipboardPayload, statusElement) {
    const text = normalizeClipboardTextValue(clipboardPayload?.text || "");
    if (!text) {
      setStatus(statusElement, "Clipboard text is empty, so there is nothing to paste into the PDF.", true);
      return;
    }

    const lineCount = Math.max(text.split(/\r?\n/).length, 1);
    const estimatedHeight = clamp(0.055 + lineCount * 0.032, 0.08, 0.28);
    const placement = buildClipboardObjectPlacement(0.3, estimatedHeight);

    upsertEditorAnnotation({
      toolSessionAnnotationId: createEditorAnnotationId(),
      annotationType: "Text",
      pageNumber: placement.pageNumber,
      payload: {
        color: getEditorAnnotationColor(),
        fontSize: 12 + getEditorStrokeWidth() * 2,
        height: placement.height,
        text: text,
        width: placement.width,
        x: placement.x,
        y: placement.y
      },
      updatedOnUtc: new Date().toISOString()
    });

    scheduleEditorAnnotationSave();
    activateToolbarButton("review");
    activateEditorPanel("review");
    setStatus(statusElement, "Pasted clipboard text into the PDF editor.", false);
    setStatus(editorContextMenuState.operationStatusElement, "Pasted clipboard text into the PDF editor.", false);
  }

  async function addClipboardImageObject(clipboardPayload, statusElement) {
    const imageSource = clipboardPayload?.dataUrl || "";
    if (!imageSource) {
      setStatus(statusElement, "Clipboard image data could not be read.", true);
      return;
    }

    const aspectRatio = await getImageAspectRatio(imageSource);
    let width = 0.28;
    let height = clamp(width / Math.max(aspectRatio, 0.2), 0.12, 0.42);
    if (height >= 0.42) {
      height = 0.42;
      width = clamp(height * Math.max(aspectRatio, 0.2), 0.18, 0.56);
    }

    const placement = buildClipboardObjectPlacement(width, height);

    upsertEditorAnnotation({
      toolSessionAnnotationId: createEditorAnnotationId(),
      annotationType: "Image",
      pageNumber: placement.pageNumber,
      payload: {
        alt: clipboardPayload.fileName || "Pasted image",
        height: placement.height,
        src: imageSource,
        width: placement.width,
        x: placement.x,
        y: placement.y,
        zIndex: getNextAttachmentZIndex()
      },
      updatedOnUtc: new Date().toISOString()
    });

    scheduleEditorAnnotationSave();
    activateToolbarButton("attachments");
    activateEditorPanel("attachments");
    setStatus(statusElement, "Pasted an image into the PDF editor.", false);
    setStatus(editorContextMenuState.operationStatusElement, "Pasted an image into the PDF editor.", false);
  }

  function addClipboardLinkObject(clipboardPayload, statusElement) {
    const url = normalizeClipboardTextValue(clipboardPayload?.url || "");
    if (!isSupportedClipboardUrl(url)) {
      setStatus(statusElement, "Clipboard URL is not a supported web address.", true);
      return;
    }

    const placement = buildClipboardObjectPlacement(0.3, 0.07);

    upsertEditorAnnotation({
      toolSessionAnnotationId: createEditorAnnotationId(),
      annotationType: "Link",
      pageNumber: placement.pageNumber,
      payload: {
        height: placement.height,
        label: clipboardPayload.label || buildClipboardLinkLabel(url),
        url: url,
        width: placement.width,
        x: placement.x,
        y: placement.y,
        zIndex: getNextAttachmentZIndex()
      },
      updatedOnUtc: new Date().toISOString()
    });

    scheduleEditorAnnotationSave();
    activateToolbarButton("attachments");
    activateEditorPanel("attachments");
    setStatus(statusElement, "Pasted a link into the PDF editor.", false);
    setStatus(editorContextMenuState.operationStatusElement, "Pasted a link into the PDF editor.", false);
  }

  async function getImageAspectRatio(dataUrl) {
    return await new Promise(function (resolve) {
      const image = new Image();
      image.onload = function () {
        resolve(Math.max(image.naturalWidth / Math.max(image.naturalHeight, 1), 0.2));
      };
      image.onerror = function () {
        resolve(1.35);
      };
      image.src = dataUrl;
    });
  }

  async function applyDetectedTextLayoutUpdate(textBlock, nextBounds, keepOriginal) {
    const toolSessionId = requireEditToolSession(editorTextState.statusElement);
    if (!toolSessionId || !textBlock) {
      return;
    }

    const operationLabel = keepOriginal ? "Duplicating selected text..." : "Moving selected text...";
    setStatus(editorTextState.statusElement, operationLabel, false);
    setStatus(editorTextState.operationStatusElement, operationLabel, false);

    try {
      await enqueueDetectedTextOperation(async function () {
        await flushPendingEditorAnnotationSave();
        const nextStyle = getPendingDetectedTextStyle(textBlock);
        const stylePayload = buildDetectedTextStylePayload(textBlock, nextStyle);
        const expectsPreservedSourceMode = shouldExpectPreservedSourcePreviewMode(textBlock, nextBounds, nextStyle, textBlock.text);
        const response = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/update-text-layout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...stylePayload,
            text: textBlock.text,
            textObjectId: textBlock.textObjectId || "",
            textBlockId: textBlock.textBlockId,
            x: nextBounds.x,
            y: nextBounds.y,
            width: nextBounds.width,
            height: nextBounds.height,
            keepOriginal: keepOriginal
          })
        });

        applyLocalTextOperationResponse(response);
        const resultTextBlock = response?.operation?.resultTextBlock && typeof response.operation.resultTextBlock === "object"
          ? response.operation.resultTextBlock
          : null;
        setStatus(editorTextState.statusElement, keepOriginal ? "Pasted a duplicated text block." : "Moved the selected text object.", false);
        setStatus(editorTextState.operationStatusElement, response.session.lastOperationSummary || "Updated the text object.", false);
        if (expectsPreservedSourceMode && getDetectedTextPreviewMode(resultTextBlock) !== "preserved-source") {
          warnDetectedTextPreviewFallback(
            resultTextBlock || textBlock,
            "Moved text is using preview mode; slight visual shift may occur until save."
          );
        }
      });
    } catch (error) {
      editorTextState.pendingSelection = null;
      setStatus(editorTextState.statusElement, error.message, true);
      setStatus(editorTextState.operationStatusElement, error.message, true);
    }
  }

  function applyDetectedTextPreviewToElement(element, bounds, pageSurface, textBlock) {
    if (!element) {
      return;
    }

    applyDetectedTextElementBounds(element, bounds, pageSurface || element.closest(".pdfjs-page-surface"), textBlock || getSelectedDetectedTextBlock());
  }

  function setPendingSelectionFromTextOperation(operation) {
    if (!operation || typeof operation !== "object") {
      editorTextState.pendingSelection = null;
      return;
    }

    const resultTextBlock = operation.resultTextBlock && typeof operation.resultTextBlock === "object"
      ? operation.resultTextBlock
      : null;
    const resultText = resultTextBlock ? resultTextBlock.text : (operation.text || "");

    editorTextState.pendingSelection = {
      clearSelection: !resultTextBlock && !normalizeClipboardTextValue(resultText),
      keepOriginal: Boolean(operation.keepOriginal),
      pageNumber: Number(operation.pageNumber) || 0,
      resultTextObjectId: resultTextBlock ? getDetectedTextSelectionId(resultTextBlock) : "",
      resultTextBlockId: resultTextBlock ? resultTextBlock.textBlockId : "",
      sourceTextObjectId: operation.sourceTextObjectId || "",
      sourceTextBlockId: operation.sourceTextBlockId || "",
      text: resultText,
      x: resultTextBlock ? resultTextBlock.x : 0,
      y: resultTextBlock ? resultTextBlock.y : 0
    };
  }

  function bindEditorPageSurface(pageSurface) {
    if (pageSurface.dataset.selectionBound === "true") {
      return;
    }

    pageSurface.dataset.selectionBound = "true";
    pageSurface.addEventListener("pointerdown", function (event) {
      closeEditorContextMenu();
      setEditorPlacementAnchorFromEvent(
        pageSurface,
        event,
        Number(pageSurface.closest("[data-page-number]")?.dataset.pageNumber || editorAnnotationState.activePageNumber || 1)
      );

      if (editorAnnotationState.activeTool !== "select") {
        return;
      }

      if (
        event.target.closest("[data-annotation-id]") ||
        event.target.closest("[data-text-block-id]") ||
        event.target.closest(".pdfjs-text-layer")
      ) {
        return;
      }

      if (!editorAnnotationState.selectedAnnotationId && !editorTextState.selectedTextBlockId) {
        return;
      }

      editorAnnotationState.selectedAnnotationId = "";
      editorTextState.selectedTextBlockId = "";
      clearInlineDetectedTextEditState();
      clearViewerTextSelection();
      renderDetectedTextBlocks();
      renderEditorAnnotations();
    });
  }

  function selectDetectedTextBlock(textBlockId, focusInViewer, options) {
    closeEditorContextMenu();
    const textBlock = findDetectedTextBlock(textBlockId);
    if (!textBlock) {
      return;
    }

    const settings = {
      preserveViewerSelection: false,
      skipAutoApply: false,
      ...(options || {})
    };

    const nextSelectionId = getDetectedTextSelectionId(textBlock);
    if (!settings.preserveViewerSelection) {
      clearViewerTextSelection();
    }

    if (!settings.skipAutoApply
      && editorTextState.editingTextBlockId
      && editorTextState.editingTextBlockId !== nextSelectionId
      && (editorTextState.inlineEditorDirty || editorTextState.inlineEditorCommitTargetId === editorTextState.editingTextBlockId)) {
      scheduleInlineDetectedTextAutoApply(editorTextState.editingTextBlockId, {
        nextSelectionFocusInViewer: !!focusInViewer,
        nextSelectionId,
        nextSelectionPreserveViewerSelection: settings.preserveViewerSelection
      });
      return;
    }

    if (editorTextState.editingTextBlockId && editorTextState.editingTextBlockId !== nextSelectionId) {
      clearInlineDetectedTextEditState();
    }

    editorTextState.selectedTextBlockId = nextSelectionId;
    primeDetectedTextStyleControls(textBlock);
    editorTextState.pendingSelection = null;
    editorAnnotationState.selectedAnnotationId = "";
    editorAnnotationState.activeTool = "select";
    ensureDetectedTextFontResourcesForTextBlock(textBlock);
    flashDetectedTextBlock(nextSelectionId);
    updateEditorAnnotationControls();
    renderDetectedTextBlocks();
    renderEditorAnnotations();
    setStatus(editorTextState.statusElement, `Selected detected text on page ${textBlock.pageNumber}.`, false);

    if (focusInViewer) {
      getEditPdfViewer()
        .then(function (viewer) {
          viewer.focusPage(textBlock.pageNumber);
        })
        .catch(function () {
        });
    }
  }

  function primeDetectedTextStyleControls(textBlock) {
    if (!textBlock) {
      return;
    }

    const preferredStyle = resolveDetectedTextPreferredStyle(textBlock);

    const fontNameInput = document.getElementById("detected-text-font-name");
    const fontSizeInput = document.getElementById("detected-text-font-size");
    const colorInput = document.getElementById("detected-text-color");
    const boldButton = document.getElementById("detected-text-bold");
    const italicButton = document.getElementById("detected-text-italic");

    if (fontNameInput) {
      fontNameInput.value = String(preferredStyle.fontName || textBlock.fontName || textBlock.sourceFontName || "").trim();
    }

    if (fontSizeInput) {
      fontSizeInput.value = String(Number(
        preferredStyle.fontSize
        || textBlock.fontSize
        || textBlock.renderedFontSize
        || textBlock.sourceFontSize
        || textBlock.sourceRenderedFontSize
        || 12
      ).toFixed(1));
    }

    if (colorInput) {
      colorInput.value = normalizeDetectedTextColorHex(preferredStyle.colorHex || textBlock.colorHex || textBlock.sourceColorHex || "#0f172a");
    }

    setDetectedTextStyleButtonState(
      boldButton,
      typeof preferredStyle.isBold === "boolean" ? preferredStyle.isBold : (typeof textBlock.isBold === "boolean" ? textBlock.isBold : !!textBlock.sourceIsBold),
      false
    );
    setDetectedTextStyleButtonState(
      italicButton,
      typeof preferredStyle.isItalic === "boolean" ? preferredStyle.isItalic : (typeof textBlock.isItalic === "boolean" ? textBlock.isItalic : !!textBlock.sourceIsItalic),
      false
    );
  }

  function updateDetectedTextControls() {
    const textValueInput = document.getElementById("detected-text-value");
    const fontNameInput = document.getElementById("detected-text-font-name");
    const fontSizeInput = document.getElementById("detected-text-font-size");
    const colorInput = document.getElementById("detected-text-color");
    const boldButton = document.getElementById("detected-text-bold");
    const italicButton = document.getElementById("detected-text-italic");
    const selectedCountElement = document.getElementById("text-object-selected-count");
    const selectedTextBlock = getSelectedDetectedTextBlock();
    const preferredStyle = selectedTextBlock ? resolveDetectedTextPreferredStyle(selectedTextBlock) : null;
    const selectedTextValue = getSelectedEditableTextValue();
    const selectedSelectionId = selectedTextBlock ? getDetectedTextSelectionId(selectedTextBlock) : "";
    const isActivelyEditingSelectedBlock = !!selectedSelectionId && editorTextState.editingTextBlockId === selectedSelectionId;

    if (selectedCountElement) {
      selectedCountElement.textContent = selectedTextBlock ? "1" : "0";
    }

    if (textValueInput) {
      if (isActivelyEditingSelectedBlock) {
        if (textValueInput.value !== editorTextState.inlineEditorValue) {
          textValueInput.value = editorTextState.inlineEditorValue;
        }
      } else {
        textValueInput.value = selectedTextValue || "";
      }
      textValueInput.placeholder = selectedTextBlock
        ? "Update the selected PDF text here"
        : "Select detected PDF text to change it";
    }

    if (fontNameInput) {
      fontNameInput.disabled = !selectedTextBlock;
      if (!isActivelyEditingSelectedBlock) {
        fontNameInput.value = selectedTextBlock ? String(preferredStyle?.fontName || selectedTextBlock.fontName || "") : "";
      }
      fontNameInput.placeholder = selectedTextBlock ? "Use the current PDF font" : "Select detected text first";
    }

    if (fontSizeInput) {
      fontSizeInput.disabled = !selectedTextBlock;
      if (!isActivelyEditingSelectedBlock) {
        fontSizeInput.value = selectedTextBlock ? String(Number(preferredStyle?.fontSize || selectedTextBlock.fontSize || selectedTextBlock.renderedFontSize || 12).toFixed(1)) : "";
      }
    }

    if (colorInput) {
      colorInput.disabled = !selectedTextBlock;
      if (!isActivelyEditingSelectedBlock) {
        colorInput.value = normalizeDetectedTextColorHex(preferredStyle?.colorHex || selectedTextBlock?.colorHex || "#0f172a");
      }
    }

    if (isActivelyEditingSelectedBlock) {
      setDetectedTextStyleButtonState(boldButton, boldButton?.getAttribute("aria-pressed") === "true", !selectedTextBlock);
      setDetectedTextStyleButtonState(italicButton, italicButton?.getAttribute("aria-pressed") === "true", !selectedTextBlock);
      return;
    }

    setDetectedTextStyleButtonState(boldButton, !!selectedTextBlock && !!preferredStyle?.isBold, !selectedTextBlock);
    setDetectedTextStyleButtonState(italicButton, !!selectedTextBlock && !!preferredStyle?.isItalic, !selectedTextBlock);
  }

  function setDetectedTextStyleButtonState(button, isPressed, isDisabled) {
    if (!button) {
      return;
    }

    button.setAttribute("aria-pressed", isPressed ? "true" : "false");
    button.disabled = !!isDisabled;
  }

  function normalizeDetectedTextColorHex(colorHex) {
    const normalizedColor = String(colorHex || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(normalizedColor)) {
      return normalizedColor;
    }

    return "#0f172a";
  }

  function getPendingDetectedTextStyle(textBlock) {
    const fontNameInput = document.getElementById("detected-text-font-name");
    const fontSizeInput = document.getElementById("detected-text-font-size");
    const colorInput = document.getElementById("detected-text-color");
    const boldButton = document.getElementById("detected-text-bold");
    const italicButton = document.getElementById("detected-text-italic");

    const activeSelectedTextBlock = getSelectedDetectedTextBlock();
    const useControlValues = !!activeSelectedTextBlock
      && !!textBlock
      && getDetectedTextSelectionId(activeSelectedTextBlock) === getDetectedTextSelectionId(textBlock);

    const preferredStyle = resolveDetectedTextPreferredStyle(textBlock);
    const fallbackFontName = String(preferredStyle?.fontName || textBlock?.fontName || "");
    const fallbackFontSize = Number(preferredStyle?.fontSize || textBlock?.fontSize || textBlock?.renderedFontSize || 12);
    const fallbackColorHex = normalizeDetectedTextColorHex(preferredStyle?.colorHex || textBlock?.colorHex || "#0f172a");

    const nextFontSize = Number(fontSizeInput?.value);
    return {
      canEmbedForEditing: !!preferredStyle?.canEmbedForEditing,
      colorHex: normalizeDetectedTextColorHex(useControlValues ? (colorInput?.value || fallbackColorHex) : fallbackColorHex),
      editCapability: String(preferredStyle?.editCapability || ""),
      fontFamily: String(preferredStyle?.fontFamily || ""),
      fontName: String(useControlValues ? (fontNameInput?.value || fallbackFontName) : fallbackFontName).trim() || fallbackFontName,
      fontPostScriptName: String(preferredStyle?.fontPostScriptName || ""),
      fontResolutionStatus: String(preferredStyle?.fontResolutionStatus || ""),
      fontResourceName: String(preferredStyle?.fontResourceName || ""),
      fontSize: useControlValues && Number.isFinite(nextFontSize) && nextFontSize > 0 ? nextFontSize : fallbackFontSize,
      fontSource: String(preferredStyle?.fontSource || ""),
      isBold: useControlValues ? boldButton?.getAttribute("aria-pressed") === "true" : !!preferredStyle?.isBold,
      isItalic: useControlValues ? italicButton?.getAttribute("aria-pressed") === "true" : !!preferredStyle?.isItalic,
      saveCapability: String(preferredStyle?.saveCapability || ""),
      toUnicodeAvailable: !!preferredStyle?.toUnicodeAvailable
    };
  }

  function hasDetectedTextStyleChanged(textBlock, nextStyle) {
    if (!textBlock || !nextStyle) {
      return false;
    }

    return String(textBlock.fontName || "") !== String(nextStyle.fontName || "")
      || Math.abs(Number(textBlock.fontSize || textBlock.renderedFontSize || 12) - Number(nextStyle.fontSize || 12)) > 0.05
      || normalizeDetectedTextColorHex(textBlock.colorHex || "#0f172a").toLowerCase() !== normalizeDetectedTextColorHex(nextStyle.colorHex || "#0f172a").toLowerCase()
      || !!textBlock.isBold !== !!nextStyle.isBold
      || !!textBlock.isItalic !== !!nextStyle.isItalic;
  }

  function buildDetectedTextStylePayload(textBlock, nextStyle) {
    if (!hasDetectedTextStyleChanged(textBlock, nextStyle)) {
      return {};
    }

    return {
      colorHex: nextStyle.colorHex,
      fontName: nextStyle.fontName,
      fontSize: nextStyle.fontSize,
      isBold: nextStyle.isBold,
      isItalic: nextStyle.isItalic
    };
  }

  function getSelectedEditableTextValue() {
    const selectedTextBlock = getSelectedDetectedTextBlock();
    if (!selectedTextBlock) {
      return "";
    }

    return getEditableDetectedTextContent(selectedTextBlock);
  }

  function getEditableDetectedTextContent(textBlock) {
    if (!textBlock || typeof textBlock !== "object") {
      return "";
    }

    const previewMode = getDetectedTextPreviewMode(textBlock);
    const preferredLayoutLines = previewMode === "preview"
      ? (Array.isArray(textBlock?.layoutLines) && textBlock.layoutLines.length ? textBlock.layoutLines : [])
      : (Array.isArray(textBlock?.sourceLayoutLines) && textBlock.sourceLayoutLines.length
        ? textBlock.sourceLayoutLines
        : (Array.isArray(textBlock?.layoutLines) && textBlock.layoutLines.length ? textBlock.layoutLines : []));

    if (preferredLayoutLines.length) {
      return preferredLayoutLines.join("\n");
    }

    return String(textBlock.text || "");
  }

  function clearStoredViewerTextSelection() {
    editorTextState.selectedViewerSelection = null;
    editorTextState.selectedViewerText = "";
  }

  function clearNativeViewerTextSelection() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    try {
      selection.removeAllRanges();
    } catch (_error) {
    }
  }

  function clearViewerTextSelection() {
    clearNativeViewerTextSelection();
    clearStoredViewerTextSelection();
  }

  function getInlineDetectedTextValue(textBlock) {
    const selectionId = getDetectedTextSelectionId(textBlock);
    if (selectionId && editorTextState.editingTextBlockId === selectionId) {
      return typeof editorTextState.inlineEditorValue === "string"
        ? editorTextState.inlineEditorValue
        : getEditableDetectedTextContent(textBlock);
    }

    return getEditableDetectedTextContent(textBlock);
  }

  function openDetectedTextBlockInlineEditor(textBlockId, options) {
    const selectionId = String(textBlockId || "");
    if (!selectionId) {
      return;
    }

    if (editorTextState.editingTextBlockId && editorTextState.editingTextBlockId !== selectionId) {
      scheduleInlineDetectedTextAutoApply(editorTextState.editingTextBlockId, {
        nextSelectionBeginInlineEdit: true,
        nextSelectionFocusInViewer: !!options?.focusInViewer,
        nextSelectionId: selectionId,
        nextSelectionPreserveViewerSelection: !!options?.preserveViewerSelection,
        nextSelectionSelectAll: options?.selectAll !== false
      });
      return;
    }

    selectDetectedTextBlock(selectionId, !!options?.focusInViewer, {
      preserveViewerSelection: !!options?.preserveViewerSelection
    });
    beginInlineDetectedTextEditing(selectionId, options);
  }

  function beginInlineDetectedTextEditing(textBlockId, options) {
    const textBlock = findDetectedTextBlock(textBlockId);
    if (!textBlock) {
      return;
    }

    activateToolbarButton("edit");
    activateEditorPanel("edit");
    clearViewerTextSelection();
    editorAnnotationState.selectedAnnotationId = "";
    editorTextState.selectedTextBlockId = getDetectedTextSelectionId(textBlock);
    primeDetectedTextStyleControls(textBlock);
    editorTextState.editingTextBlockId = getDetectedTextSelectionId(textBlock);
    ensureDetectedTextFontResourcesForTextBlock(textBlock);
    editorTextState.inlineEditorSourceText = getEditableDetectedTextContent(textBlock);
    editorTextState.inlineEditorValue = options?.value ?? editorTextState.inlineEditorSourceText;
    editorTextState.inlineEditorDirty = false;
    editorTextState.inlineEditorPendingFocus = options?.focus !== false;
    editorTextState.inlineEditorSelectAllOnFocus = options?.selectAll !== false;
    renderDetectedTextBlocks();
  }

  function clearInlineDetectedTextEditState() {
    clearInlineDetectedTextAutoApplyTimer();
    editorTextState.editingTextBlockId = "";
    editorTextState.inlineEditorCommitTargetId = "";
    editorTextState.inlineEditorDirty = false;
    editorTextState.inlineEditorPendingFocus = false;
    editorTextState.inlineEditorSelectAllOnFocus = false;
    editorTextState.inlineEditorSourceText = "";
    editorTextState.inlineEditorValue = "";
  }

  function cancelInlineDetectedTextEditing() {
    const selectedTextBlock = getSelectedDetectedTextBlock();
    clearInlineDetectedTextEditState();
    updateDetectedTextControls();
    renderDetectedTextBlocks();
    if (selectedTextBlock) {
      setStatus(editorTextState.statusElement, "Inline editing cancelled for the selected text block.", false);
    }
  }

  function syncDetectedTextDraftValue(nextValue, source) {
    const selectedTextBlock = getSelectedDetectedTextBlock();
    if (!selectedTextBlock) {
      return;
    }

    const selectionId = getDetectedTextSelectionId(selectedTextBlock);
    if (editorTextState.editingTextBlockId !== selectionId) {
      editorTextState.editingTextBlockId = selectionId;
      editorTextState.inlineEditorSourceText = getEditableDetectedTextContent(selectedTextBlock);
      editorTextState.inlineEditorPendingFocus = false;
      editorTextState.inlineEditorSelectAllOnFocus = false;
    }

    editorTextState.inlineEditorValue = normalizeEditableTextValue(nextValue);
    editorTextState.inlineEditorDirty = normalizeEditableTextForComparison(editorTextState.inlineEditorValue)
      !== normalizeEditableTextForComparison(editorTextState.inlineEditorSourceText);

    if (source !== "inline" && !document.querySelector(`.detected-text-inline-editor[data-text-block-id="${selectionId}"]`)) {
      renderDetectedTextBlocks();
      return;
    }

    const panelTextarea = document.getElementById("detected-text-value");
    if (panelTextarea && source !== "panel" && panelTextarea.value !== editorTextState.inlineEditorValue) {
      panelTextarea.value = editorTextState.inlineEditorValue;
    }

    const inlineTextarea = document.querySelector(`.detected-text-inline-editor[data-text-block-id="${selectionId}"]`);
    if (inlineTextarea && source !== "inline" && inlineTextarea.value !== editorTextState.inlineEditorValue) {
      const selectionStart = inlineTextarea.selectionStart;
      const selectionEnd = inlineTextarea.selectionEnd;
      inlineTextarea.value = editorTextState.inlineEditorValue;
      if (typeof selectionStart === "number" && typeof selectionEnd === "number") {
        inlineTextarea.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }

  function clearInlineDetectedTextAutoApplyTimer() {
    if (editorTextState.inlineEditorAutoApplyTimer) {
      window.clearTimeout(editorTextState.inlineEditorAutoApplyTimer);
      editorTextState.inlineEditorAutoApplyTimer = 0;
    }
  }

  function scheduleInlineDetectedTextAutoApply(textBlockId, options) {
    if (!textBlockId || editorTextState.editingTextBlockId !== textBlockId) {
      return;
    }

    clearInlineDetectedTextAutoApplyTimer();
    editorTextState.inlineEditorAutoApplyTimer = window.setTimeout(function () {
      editorTextState.inlineEditorAutoApplyTimer = 0;
      void applyDetectedTextChange({
        nextSelectionBeginInlineEdit: !!options?.nextSelectionBeginInlineEdit,
        nextSelectionFocusInViewer: !!options?.nextSelectionFocusInViewer,
        statusElement: editorTextState.statusElement,
        nextSelectionPreserveViewerSelection: !!options?.nextSelectionPreserveViewerSelection,
        nextSelectionSelectAll: options?.nextSelectionSelectAll !== false,
        textBlockId,
        suppressNoChangeStatus: true,
        nextSelectionId: options?.nextSelectionId || ""
      }).catch(function (error) {
        setStatus(editorTextState.statusElement, error.message, true);
        setStatus(editorTextState.operationStatusElement, error.message, true);
      });
    }, 0);
  }

  async function applyDetectedTextChange(options) {
    const settings = {
      nextSelectionBeginInlineEdit: false,
      nextSelectionFocusInViewer: false,
      nextSelectionId: "",
      nextSelectionPreserveViewerSelection: false,
      nextSelectionSelectAll: true,
      statusElement: editorTextState.statusElement,
      suppressNoChangeStatus: false,
      textBlockId: "",
      textValueInput: document.getElementById("detected-text-value"),
      ...(options || {})
    };
    const selectedTextBlock = settings.textBlockId
      ? findDetectedTextBlock(settings.textBlockId)
      : getSelectedDetectedTextBlock();
    if (!selectedTextBlock) {
      if (!settings.suppressNoChangeStatus) {
        setStatus(editorTextState.statusElement, "Select detected PDF text before applying a change.", true);
      }
      return false;
    }

    const selectionId = getDetectedTextSelectionId(selectedTextBlock);
    const isInlineEditingSelectedBlock = editorTextState.editingTextBlockId === selectionId;
    const replacementText = isInlineEditingSelectedBlock
      ? editorTextState.inlineEditorValue
      : (settings.textValueInput?.value || "");
    const selectedTextValue = isInlineEditingSelectedBlock
      ? (editorTextState.inlineEditorSourceText || getEditableDetectedTextContent(selectedTextBlock))
      : getEditableDetectedTextContent(selectedTextBlock);
    const nextStyle = getPendingDetectedTextStyle(selectedTextBlock);

    if (!selectedTextValue) {
      if (!settings.suppressNoChangeStatus) {
        setStatus(editorTextState.statusElement, "Select detected PDF text before applying a change.", true);
      }
      return false;
    }

    const hasTextChanged = normalizeEditableTextForComparison(replacementText) !== normalizeEditableTextForComparison(selectedTextValue);
    const hasStyleChanged = hasDetectedTextStyleChanged(selectedTextBlock, nextStyle);
    if (!hasTextChanged && !hasStyleChanged) {
      if (isInlineEditingSelectedBlock) {
        clearInlineDetectedTextEditState();
        updateDetectedTextControls();
        renderDetectedTextBlocks();
      }

      activatePendingDetectedTextSelection(settings, selectionId);

      if (!settings.suppressNoChangeStatus) {
        setStatus(editorTextState.statusElement, "Change the text or formatting before applying the update.", true);
      }
      return false;
    }

    if (editorTextState.inlineEditorCommitTargetId === selectionId) {
      return editorTextState.inlineEditorCommitPromise;
    }

    clearInlineDetectedTextAutoApplyTimer();
    editorTextState.inlineEditorCommitTargetId = selectionId;
    setStatus(editorTextState.statusElement, "Applying the PDF text change...", false);
    setStatus(editorTextState.operationStatusElement, "Updating the selected PDF text...", false);

    const commitPromise = submitDetectedTextReplacement(
      settings.statusElement,
      selectedTextBlock,
      selectedTextValue,
      replacementText,
      nextStyle
    ).then(function () {
      activatePendingDetectedTextSelection(settings, selectionId);
      return true;
    }).finally(function () {
      if (editorTextState.inlineEditorCommitTargetId === selectionId) {
        editorTextState.inlineEditorCommitTargetId = "";
      }
    });
    editorTextState.inlineEditorCommitPromise = commitPromise;
    return commitPromise;
  }

  function activatePendingDetectedTextSelection(settings, currentSelectionId) {
    if (!settings.nextSelectionId || settings.nextSelectionId === currentSelectionId) {
      return;
    }

    if (settings.nextSelectionBeginInlineEdit) {
      openDetectedTextBlockInlineEditor(settings.nextSelectionId, {
        focusInViewer: settings.nextSelectionFocusInViewer,
        preserveViewerSelection: settings.nextSelectionPreserveViewerSelection,
        selectAll: settings.nextSelectionSelectAll
      });
      return;
    }

    selectDetectedTextBlock(settings.nextSelectionId, settings.nextSelectionFocusInViewer, {
      preserveViewerSelection: settings.nextSelectionPreserveViewerSelection,
      skipAutoApply: true
    });
  }

  function getDetectedTextMaskBaseColor(textBlock) {
    const sourceBackgrounds = Array.isArray(textBlock?.sourcePreviewBackgrounds)
      ? textBlock.sourcePreviewBackgrounds
      : [];
    if (!sourceBackgrounds.length) {
      return {
        colorHex: "#ffffff",
        opacity: 0.98
      };
    }

    return sourceBackgrounds.reduce(function (bestMatch, candidateBackground) {
      const candidateArea = Math.max(Number(candidateBackground?.width) || 0, 0) * Math.max(Number(candidateBackground?.height) || 0, 0);
      const candidateOpacity = clamp(Number(candidateBackground?.opacity) || 1, 0, 1);
      const candidateScore = candidateArea * Math.max(candidateOpacity, 0.18);
      const bestArea = Math.max(Number(bestMatch?.width) || 0, 0) * Math.max(Number(bestMatch?.height) || 0, 0);
      const bestOpacity = clamp(Number(bestMatch?.opacity) || 1, 0, 1);
      const bestScore = bestArea * Math.max(bestOpacity, 0.18);
      return candidateScore > bestScore ? candidateBackground : bestMatch;
    }, sourceBackgrounds[0]);
  }

  function buildDetectedTextMaskBaseElement(textBlock, className) {
    const baseMask = document.createElement("div");
    const baseFill = getDetectedTextMaskBaseColor(textBlock);
    baseMask.className = className;
    baseMask.style.backgroundColor = resolveDetectedTextColor({ colorHex: baseFill.colorHex || "#ffffff" });
    baseMask.style.opacity = `${clamp(Number(baseFill.opacity) || 1, 0.18, 1)}`;
    return baseMask;
  }

  function replaceFirstOccurrence(sourceValue, searchValue, replacementValue) {
    const sourceText = String(sourceValue || "");
    const targetText = String(searchValue || "");
    if (!targetText) {
      return replacementValue;
    }

    const targetIndex = sourceText.indexOf(targetText);
    if (targetIndex < 0) {
      return replacementValue;
    }

    return `${sourceText.slice(0, targetIndex)}${replacementValue}${sourceText.slice(targetIndex + targetText.length)}`;
  }

  function getFilteredDetectedTextBlocks() {
    if (!editorTextState.searchQuery) {
      return editorTextState.detectedTextBlocks;
    }

    return editorTextState.detectedTextBlocks.filter(function (textBlock) {
      return textBlock.text.toLowerCase().includes(editorTextState.searchQuery);
    });
  }

  function resolveDetectedTextSelection(previousTextBlockId) {
    if (editorTextState.pendingSelection) {
      if (
        editorTextState.pendingSelection.resultTextObjectId &&
        editorTextState.detectedTextBlocks.some(function (textBlock) {
          return getDetectedTextSelectionId(textBlock) === editorTextState.pendingSelection.resultTextObjectId;
        })
      ) {
        const exactResultTextBlockId = editorTextState.pendingSelection.resultTextObjectId;
        editorTextState.pendingSelection = null;
        return exactResultTextBlockId;
      }

      if (editorTextState.pendingSelection.clearSelection) {
        editorTextState.pendingSelection = null;
        return "";
      }

      let pendingMatches = editorTextState.detectedTextBlocks.filter(function (textBlock) {
        return textBlock.pageNumber === editorTextState.pendingSelection.pageNumber &&
          textBlock.text.trim() === editorTextState.pendingSelection.text;
      });

      if (editorTextState.pendingSelection.keepOriginal && editorTextState.pendingSelection.sourceTextObjectId) {
        const duplicateMatches = pendingMatches.filter(function (textBlock) {
          return getDetectedTextSelectionId(textBlock) !== editorTextState.pendingSelection.sourceTextObjectId;
        });

        if (duplicateMatches.length) {
          pendingMatches = duplicateMatches;
        }
      }

      const pendingMatch = pendingMatches.sort(function (left, right) {
        const leftDistance = Math.hypot(
          (left.x || 0) - (editorTextState.pendingSelection.x || 0),
          (left.y || 0) - (editorTextState.pendingSelection.y || 0)
        );
        const rightDistance = Math.hypot(
          (right.x || 0) - (editorTextState.pendingSelection.x || 0),
          (right.y || 0) - (editorTextState.pendingSelection.y || 0)
        );
        return leftDistance - rightDistance;
      })[0];

      editorTextState.pendingSelection = null;
      if (pendingMatch) {
        return getDetectedTextSelectionId(pendingMatch);
      }
    }

    if (previousTextBlockId && editorTextState.detectedTextBlocks.some(function (textBlock) { return getDetectedTextSelectionId(textBlock) === previousTextBlockId; })) {
      return previousTextBlockId;
    }

    return "";
  }

  function compareDetectedTextBlocks(left, right) {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    if (left.y !== right.y) {
      return left.y - right.y;
    }

    if (left.x !== right.x) {
      return left.x - right.x;
    }

    return left.text.localeCompare(right.text);
  }

  function findDetectedTextBlock(textBlockId) {
    return editorTextState.detectedTextBlocks.find(function (textBlock) {
      const selectionId = getDetectedTextSelectionId(textBlock);
      return selectionId === textBlockId || textBlock.textBlockId === textBlockId;
    }) || null;
  }

  function getSelectedDetectedTextBlock() {
    return findDetectedTextBlock(editorTextState.selectedTextBlockId);
  }

  function buildDetectedTextHeading(textBlock) {
    const preview = textBlock.text.length > 36
      ? `${textBlock.text.slice(0, 36)}...`
      : textBlock.text;

    return preview || `Page ${textBlock.pageNumber} text`;
  }

  function flashDetectedTextBlock(textBlockId) {
    editorTextState.flashedTextBlockId = textBlockId;
    window.clearTimeout(editorTextState.flashTimer);
    editorTextState.flashTimer = window.setTimeout(function () {
      if (editorTextState.flashedTextBlockId === textBlockId) {
        editorTextState.flashedTextBlockId = "";
        if (!editorTextState.editingTextBlockId) {
          renderDetectedTextBlocks();
        }
      }
    }, 1150);
  }

  function initializeEditorAttachments(statusElement, operationStatusElement) {
    const attachmentFileInput = document.getElementById("attachment-file-input");
    const addAttachmentButton = document.getElementById("add-document-attachment");
    const imageInput = document.getElementById("attachment-image-file");
    const addImageButton = document.getElementById("add-image-object");
    const addLinkButton = document.getElementById("add-link-object");
    const bringForwardButton = document.getElementById("bring-selected-object-forward");
    const sendBackButton = document.getElementById("send-selected-object-back");
    const attachmentStatusElement = document.getElementById("attachment-status");

    if (!imageInput || imageInput.dataset.bound === "true") {
      return;
    }

    imageInput.dataset.bound = "true";

    if (attachmentFileInput && addAttachmentButton) {
      addAttachmentButton.addEventListener("click", async function () {
        const toolSessionId = requireEditToolSession(statusElement);
        const file = attachmentFileInput.files && attachmentFileInput.files[0];

        if (!toolSessionId) {
          return;
        }

        if (!file) {
          setStatus(attachmentStatusElement, "Choose a file before adding a document attachment.", true);
          return;
        }

        const formData = new FormData();
        formData.append("file", file, file.name);

        setStatus(attachmentStatusElement, "Uploading the file attachment...", false);
        setStatus(operationStatusElement, "Uploading the file attachment...", false);

        try {
          const updatedSession = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/attachments`, {
            method: "POST",
            body: formData
          });

          renderEditSession(updatedSession, {
            panelName: "attachments",
            reloadDetectedText: false,
            reloadViewer: false,
            toolbarAction: "attachments"
          });
          attachmentFileInput.value = "";
          activateToolbarButton("attachments");
          activateEditorPanel("attachments");
          setStatus(attachmentStatusElement, "File attachment added to the editor workspace.", false);
          setStatus(operationStatusElement, updatedSession.lastOperationSummary || "Added the file attachment.", false);
        } catch (error) {
          setStatus(attachmentStatusElement, error.message, true);
          setStatus(operationStatusElement, error.message, true);
        }
      });
    }

    addImageButton.addEventListener("click", async function () {
      const file = imageInput.files && imageInput.files[0];
      if (!file) {
        setStatus(attachmentStatusElement, "Choose an image before adding it to the page.", true);
        return;
      }

      if (!file.type.startsWith("image/")) {
        setStatus(attachmentStatusElement, "Only image files can be added as image objects.", true);
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const pageNumber = editorAnnotationState.activePageNumber || 1;
      const nextZIndex = getNextAttachmentZIndex();

      upsertEditorAnnotation({
        toolSessionAnnotationId: createEditorAnnotationId(),
        annotationType: "Image",
        pageNumber: pageNumber,
        payload: {
          alt: file.name,
          height: 0.2,
          src: dataUrl,
          width: 0.28,
          x: 0.12,
          y: 0.12,
          zIndex: nextZIndex
        },
        updatedOnUtc: new Date().toISOString()
      });

      scheduleEditorAnnotationSave();
      activateToolbarButton("attachments");
      activateEditorPanel("attachments");
      setStatus(attachmentStatusElement, "Image object added to the current page.", false);
      setStatus(operationStatusElement, "Added an image object to the current page.", false);
      imageInput.value = "";
    });

    addLinkButton.addEventListener("click", function () {
      const labelInput = document.getElementById("attachment-link-label");
      const urlInput = document.getElementById("attachment-link-url");
      const label = labelInput.value.trim();
      const url = urlInput.value.trim();

      if (!url || !/^https?:\/\//i.test(url)) {
        setStatus(attachmentStatusElement, "Enter a valid URL that starts with http:// or https://.", true);
        return;
      }

      upsertEditorAnnotation({
        toolSessionAnnotationId: createEditorAnnotationId(),
        annotationType: "Link",
        pageNumber: editorAnnotationState.activePageNumber || 1,
        payload: {
          height: 0.06,
          label: label || "Open link",
          url: url,
          width: 0.26,
          x: 0.12,
          y: 0.18,
          zIndex: getNextAttachmentZIndex()
        },
        updatedOnUtc: new Date().toISOString()
      });

      scheduleEditorAnnotationSave();
      activateToolbarButton("attachments");
      activateEditorPanel("attachments");
      setStatus(attachmentStatusElement, "Link object added to the current page.", false);
      setStatus(operationStatusElement, "Added a link object to the current page.", false);
      labelInput.value = "";
      urlInput.value = "";
    });

    bringForwardButton.addEventListener("click", function () {
      updateSelectedAttachmentObjectOrder("front");
    });

    sendBackButton.addEventListener("click", function () {
      updateSelectedAttachmentObjectOrder("back");
    });
  }

  function initializeEditorUnlock(statusElement, operationStatusElement) {
    const unlockButton = document.getElementById("unlock-current-pdf");
    if (!unlockButton || unlockButton.dataset.bound === "true") {
      return;
    }

    unlockButton.dataset.bound = "true";
    unlockButton.addEventListener("click", async function () {
      const session = getSession();
      const toolSessionId = requireEditToolSession(statusElement);
      const password = document.getElementById("unlock-password").value || "";

      if (!toolSessionId) {
        return;
      }

      if (!session) {
        window.location.href = createReturnUrl("/login");
        return;
      }

      if (session.subscriptionTier !== PAID_SUBSCRIPTION_TIER) {
        setStatus(statusElement, "Unlock PDF is available for paid users only.", true);
        return;
      }

      if (!currentEditSession || !currentEditSession.isProtected) {
        setStatus(statusElement, "This PDF is not protected.", true);
        return;
      }

      setStatus(statusElement, "Unlocking the protected PDF...", false);
      setStatus(operationStatusElement, "Unlocking the protected PDF...", false);

      try {
        const updatedSession = await fetchJson(`/api/v1/tool-sessions/${toolSessionId}/unlock`, {
          method: "POST",
          headers: createAuthorizedHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ password: password })
        });

        renderEditSession(updatedSession);
        document.getElementById("unlock-password").value = "";
        setStatus(statusElement, "The PDF is unlocked and ready for editing.", false);
        setStatus(operationStatusElement, updatedSession.lastOperationSummary || "Unlocked the PDF successfully.", false);
      } catch (error) {
        setStatus(statusElement, error.message, true);
        setStatus(operationStatusElement, error.message, true);
      }
    });
  }

  function renderUnlockState(session) {
    const unlockPanel = document.getElementById("unlock-panel");
    const unlockSummary = document.getElementById("unlock-summary");
    const unlockTierChip = document.getElementById("unlock-tier-chip");
    const unlockToolbarButton = document.getElementById("unlock-pdf-button");
    const activeSession = getSession();
    const subscriptionTier = activeSession?.subscriptionTier || "Free";
    const isPaidUser = subscriptionTier === PAID_SUBSCRIPTION_TIER;

    if (unlockTierChip) {
      unlockTierChip.textContent = subscriptionTier;
    }

    if (unlockPanel) {
      unlockPanel.hidden = !session?.isProtected;
    }

    if (unlockSummary) {
      unlockSummary.textContent = session?.isProtected
        ? (isPaidUser
            ? (session.protectionSummary || "This PDF is protected and can be unlocked.")
            : "This PDF is protected. Upgrade to a paid account to unlock it here.")
        : "This PDF is not protected.";
    }

    if (unlockToolbarButton) {
      unlockToolbarButton.hidden = !session?.isProtected;
      unlockToolbarButton.disabled = !session?.isProtected || !isPaidUser;
    }
  }

  function getNextAttachmentZIndex() {
    const values = editorAnnotationState.annotations
      .filter(isAttachmentAnnotation)
      .map(function (annotation) { return Number(annotation.payload.zIndex) || 1; });

    return (values.length ? Math.max.apply(null, values) : 0) + 1;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("We couldn't read that file right now."));
      };
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.readAsDataURL(file);
    });
  }

  function initializeEditorToolbar(statusElement, operationStatusElement) {
    const toolbar = document.getElementById("editor-floating-toolbar");
    if (!toolbar) {
      return;
    }

    toolbar.addEventListener("click", function (event) {
      const button = event.target.closest("[data-toolbar-action]");
      if (!button) {
        return;
      }

      const toolbarAction = button.dataset.toolbarAction;
      if (!toolbarAction) {
        return;
      }

      if (toolbarAction !== "edit" && !getActiveToolSessionId("edit")) {
        setStatus(statusElement, "Upload a PDF before using the editor tools.", true);
        return;
      }

      if (toolbarAction === "edit" || toolbarAction === "review" || toolbarAction === "organize" || toolbarAction === "attachments") {
        activateToolbarButton(toolbarAction);
        activateEditorPanel(toolbarAction);
        focusEditorCanvas();
        return;
      }

      if (toolbarAction === "unlock") {
        window.location.href = createReturnUrl("/unlock");
        return;
      }

      if (toolbarAction === "save") {
        activateToolbarButton(toolbarAction);
        document.getElementById("save-edited-document").click();
        return;
      }

      if (toolbarAction === "download") {
        const downloadLink = document.getElementById("download-edited-file");
        if (!downloadLink || downloadLink.classList.contains("disabled-link")) {
          setStatus(operationStatusElement, "Load a PDF and run an editor action before downloading the current file.", true);
          return;
        }

        activateToolbarButton(toolbarAction);
        downloadLink.click();
        return;
      }
    });
  }

  function bindTitleToFileName(fileInputId, titleInputId) {
    const fileInput = document.getElementById(fileInputId);
    const titleInput = document.getElementById(titleInputId);

    if (!fileInput || !titleInput) {
      return;
    }

    fileInput.addEventListener("change", function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }

      if (!titleInput.value.trim()) {
        titleInput.value = file.name.replace(/\.pdf$/i, "");
      }
    });
  }

  function syncTitleInput(titleInputId, title) {
    const titleInput = document.getElementById(titleInputId);
    if (!titleInput) {
      return;
    }

    if (!titleInput.value.trim()) {
      titleInput.value = title || "";
    }
  }

  function renderEditPdfViewer(session, options) {
    if (session && session.requiresPassword) {
      const emptyStateElement = document.getElementById("edit-viewer-empty");
      const scrollPanelElement = document.getElementById("edit-viewer-scroll");
      if (emptyStateElement) {
        emptyStateElement.hidden = false;
        emptyStateElement.textContent = session.protectionSummary || "This PDF is protected. Open the Unlock PDF tool to remove protection before editing.";
      }
      if (scrollPanelElement) {
        scrollPanelElement.hidden = true;
      }
      editorAnnotationState.viewerReady = false;
      return;
    }

    getEditPdfViewer()
      .then(function (viewer) {
        return viewer.load(session, {
          viewState: options?.viewState || null
        }).then(function () {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              if (typeof viewer.refreshLayout === "function") {
                viewer.refreshLayout();
              }
              editorAnnotationState.viewerReady = true;
              renderEditorAnnotations();
              renderDetectedTextBlocks();
            });
          });
        });
      })
      .catch(function (error) {
        console.error(error);
        setStatus(document.getElementById("edit-status"), error.message || "We couldn't load the live PDF preview right now.", true);
      });
  }

  function captureEditorViewerViewState() {
    return getEditPdfViewer()
      .then(function (viewer) {
        if (viewer && typeof viewer.getViewState === "function") {
          return viewer.getViewState();
        }

        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function getEditPdfViewer() {
    if (!editViewerPromise) {
      editViewerPromise = import(EDITOR_VIEWER_MODULE_URL).then(function (module) {
        return module.createPdfEditorViewer({
          currentPageElement: "edit-current-page",
          emptyStateElement: "edit-viewer-empty",
          fitWidthButton: "edit-fit-width",
          onActivePageChanged: function (pageNumber) {
            editorAnnotationState.activePageNumber = pageNumber;
          },
          onError: function (error) {
            console.error(error);
          },
          onPageOrderChanged: function (orderedPageNumbers) {
            applyDraggedPageOrder(orderedPageNumbers);
          },
          pageCountElement: "edit-page-count",
          pageRailElement: "edit-page-rail",
          pagesElement: "edit-viewer-pages",
          scrollPanelElement: "edit-viewer-scroll",
          zoomInButton: "edit-zoom-in",
          zoomLevelElement: "edit-zoom-level",
          zoomOutButton: "edit-zoom-out"
        });
      });
    }

    return editViewerPromise;
  }

  function initializeEditorLayoutResizers() {
    const editorShell = document.getElementById("editor-shell");
    if (!editorShell || editorShell.dataset.resizeBound === "true") {
      return;
    }

    editorShell.dataset.resizeBound = "true";
    restoreEditorLayout(editorShell);

    let dragState = null;
    let refreshFrame = null;

    editorShell.querySelectorAll("[data-editor-resize]").forEach(function (handle) {
      handle.addEventListener("dblclick", function () {
        resetEditorLayout(editorShell);
      });

      handle.addEventListener("pointerdown", function (event) {
        if (!isDesktopEditorLayout()) {
          return;
        }

        event.preventDefault();
        dragState = {
          pointerId: event.pointerId,
          side: handle.dataset.editorResize
        };

        handle.setPointerCapture(event.pointerId);
        editorShell.classList.add("editor-shell--resizing");
        document.body.classList.add("editor-resizing");
      });

      handle.addEventListener("pointermove", function (event) {
        if (!dragState || dragState.pointerId !== event.pointerId || !isDesktopEditorLayout()) {
          return;
        }

        const bounds = editorShell.getBoundingClientRect();

        if (dragState.side === "left") {
          const nextWidth = clamp(event.clientX - bounds.left, 200, 340);
          editorShell.style.setProperty("--editor-left-width", `${Math.round(nextWidth)}px`);
        } else {
          const nextWidth = clamp(bounds.right - event.clientX, 290, 460);
          editorShell.style.setProperty("--editor-right-width", `${Math.round(nextWidth)}px`);
        }

        if (refreshFrame) {
          window.cancelAnimationFrame(refreshFrame);
        }

        refreshFrame = window.requestAnimationFrame(function () {
          refreshEditorViewerLayout();
        });
      });

      handle.addEventListener("pointerup", function (event) {
        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }

        finishEditorResize(editorShell);
      });

      handle.addEventListener("pointercancel", function (event) {
        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }

        finishEditorResize(editorShell);
      });
    });

    window.addEventListener("resize", function () {
      if (!isDesktopEditorLayout()) {
        return;
      }

      refreshEditorViewerLayout();
    });

    function finishEditorResize(shell) {
      dragState = null;
      shell.classList.remove("editor-shell--resizing");
      document.body.classList.remove("editor-resizing");
      persistEditorLayout(shell);
      refreshEditorViewerLayout();
    }
  }

  function isDesktopEditorLayout() {
    return window.matchMedia("(min-width: 1201px)").matches;
  }

  function restoreEditorLayout(editorShell) {
    try {
      const savedLayout = JSON.parse(window.localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY) || "null");
      if (!savedLayout) {
        return;
      }

      if (typeof savedLayout.leftWidth === "number") {
        editorShell.style.setProperty("--editor-left-width", `${Math.round(clamp(savedLayout.leftWidth, 200, 340))}px`);
      }

      if (typeof savedLayout.rightWidth === "number") {
        editorShell.style.setProperty("--editor-right-width", `${Math.round(clamp(savedLayout.rightWidth, 290, 460))}px`);
      }
    } catch (_error) {
      window.localStorage.removeItem(EDITOR_LAYOUT_STORAGE_KEY);
    }
  }

  function resetEditorLayout(editorShell) {
    editorShell.style.removeProperty("--editor-left-width");
    editorShell.style.removeProperty("--editor-right-width");
    window.localStorage.removeItem(EDITOR_LAYOUT_STORAGE_KEY);
    refreshEditorViewerLayout();
  }

  function persistEditorLayout(editorShell) {
    const leftWidth = parseFloat(editorShell.style.getPropertyValue("--editor-left-width"));
    const rightWidth = parseFloat(editorShell.style.getPropertyValue("--editor-right-width"));

    window.localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify({
      leftWidth: Number.isFinite(leftWidth) ? leftWidth : 228,
      rightWidth: Number.isFinite(rightWidth) ? rightWidth : 338
    }));
  }

  function refreshEditorViewerLayout() {
    getEditPdfViewer()
      .then(function (viewer) {
        if (viewer && typeof viewer.refreshLayout === "function") {
          viewer.refreshLayout();
        }
      })
      .catch(function () {
      });
  }

  function activateEditorPanel(panelName, options) {
    const settings = {
      scrollIntoView: false,
      ...(options || {})
    };

    closeEditorContextMenu();
    document.querySelectorAll("[data-editor-panel]").forEach(function (panel) {
      const isActive = panel.dataset.editorPanel === panelName;
      panel.classList.toggle("sidebar-panel--active", isActive);
      panel.classList.toggle("rail-panel--active", isActive);
    });

    const targetPanel = document.querySelector(`[data-editor-panel="${panelName}"]`);
    if (targetPanel && settings.scrollIntoView) {
      targetPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function activateToolbarButton(toolbarAction) {
    document.querySelectorAll("[data-toolbar-action]").forEach(function (button) {
      button.classList.toggle("toolbar-button--active", button.dataset.toolbarAction === toolbarAction);
    });
  }

  function focusEditorCanvas() {
    const canvasPanel = document.getElementById("edit-canvas-panel");
    if (!canvasPanel) {
      return;
    }

    canvasPanel.classList.add("editor-canvas-panel--focused");
    setTimeout(function () {
      canvasPanel.classList.remove("editor-canvas-panel--focused");
    }, 1400);
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

  function buildFullOrderPlaceholder(pageCount) {
    return Array.from({ length: pageCount }, function (_, index) {
      return index + 1;
    }).join(",");
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

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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





