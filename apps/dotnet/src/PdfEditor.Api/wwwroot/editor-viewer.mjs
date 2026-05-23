import * as pdfjsLib from "/vendor/pdfjs/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.min.mjs";

const DEFAULT_SCALE = 1.1;
const MIN_SCALE = 0.65;
const MAX_SCALE = 2.25;
const THUMBNAIL_SCALE = 0.22;

export function createPdfEditorViewer(options = {}) {
  const state = {
    pageRailElement: resolveElement(options.pageRailElement),
    pageCountElement: resolveElement(options.pageCountElement),
    scrollPanelElement: resolveElement(options.scrollPanelElement),
    pagesElement: resolveElement(options.pagesElement),
    emptyStateElement: resolveElement(options.emptyStateElement),
    zoomOutButton: resolveElement(options.zoomOutButton),
    zoomInButton: resolveElement(options.zoomInButton),
    fitWidthButton: resolveElement(options.fitWidthButton),
    zoomLevelElement: resolveElement(options.zoomLevelElement),
    currentPageElement: resolveElement(options.currentPageElement),
    onActivePageChanged: typeof options.onActivePageChanged === "function" ? options.onActivePageChanged : null,
    onPageOrderChanged: typeof options.onPageOrderChanged === "function" ? options.onPageOrderChanged : null,
    onError: typeof options.onError === "function" ? options.onError : null,
    pdfDocument: null,
    loadingTask: null,
    loadSequence: 0,
    pageEntries: [],
    scale: DEFAULT_SCALE,
    fitWidthActive: true,
    basePageWidth: 0,
    activePageNumber: 1,
    scrollFrame: null,
    draggedPageNumber: null,
    renderGeneration: 0,
    renderTasks: new Set(),
    textLayerTasks: new Set()
  };

  bindEvents();
  resetViewer("Upload a PDF to open a live preview.");

  return {
    clear,
    focusPage,
    fitWidth,
    getActivePageNumber,
    getPageCount,
    getPageDetectedTextLayerElement,
    getPageOverlayElement,
    getPageTextLayerElement,
    getPageSurfaceElement,
    getViewState,
    load,
    refreshLayout,
    restoreViewState,
    zoomIn,
    zoomOut
  };

  async function load(session, options = {}) {
    if (!session || !session.fileUrl) {
      clear();
      return;
    }

    const requestedViewState = normalizeViewState(options.viewState);
    const loadSequence = ++state.loadSequence;
    const previousDocument = state.pdfDocument;
    destroyLoadingTask();
    cancelRenderTasks();
    cancelTextLayerTasks();
    const preserveStructure = previousDocument && state.pageEntries.length > 0;

    state.pdfDocument = null;
    if (!preserveStructure) {
      state.pageEntries = [];
      state.fitWidthActive = true;
      state.activePageNumber = 1;
      resetViewer("Loading your PDF preview...");
    }

    try {
      state.loadingTask = pdfjsLib.getDocument({
        cMapPacked: true,
        cMapUrl: "/vendor/pdfjs/cmaps/",
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
        url: appendCacheBust(session.fileUrl)
      });

      const pdfDocument = await state.loadingTask.promise;
      if (loadSequence !== state.loadSequence) {
        await destroyPdfDocument(pdfDocument);
        return;
      }

      state.pdfDocument = pdfDocument;

      const firstPage = await pdfDocument.getPage(1);
      const firstViewport = firstPage.getViewport({ scale: 1 });
      state.basePageWidth = firstViewport.width;
      if (requestedViewState && requestedViewState.fitWidthActive === false) {
        state.fitWidthActive = false;
        state.scale = clamp(requestedViewState.scale, MIN_SCALE, MAX_SCALE);
      } else if (!preserveStructure || state.fitWidthActive) {
        state.fitWidthActive = true;
        state.scale = calculateFitWidthScale();
      }

      if (!preserveStructure || state.pageEntries.length !== pdfDocument.numPages) {
        buildPageEntries(pdfDocument.numPages);
      }
      showDocument();
      updateZoomLabel();
      updatePageIndicator();

      await renderMainPages(loadSequence);
      await renderThumbnails(loadSequence);

      if (loadSequence !== state.loadSequence) {
        return;
      }

      const restored = restoreViewState(requestedViewState, "auto");
      if (!restored) {
        setActivePage(1);
        queueScrollSync();
      }

      if (previousDocument && previousDocument !== pdfDocument) {
        await destroyPdfDocument(previousDocument);
      }
    } catch (error) {
      if (previousDocument && previousDocument !== state.pdfDocument) {
        await destroyPdfDocument(previousDocument);
      }
      clear();
      notifyError(error);
      throw new Error("We couldn't load the PDF preview right now. Please try this file again.");
    }
  }

  function clear() {
    state.loadSequence += 1;
    destroyLoadingTask();
    cancelRenderTasks();
    cancelTextLayerTasks();
    void destroyPdfDocument(state.pdfDocument);
    state.pdfDocument = null;
    state.pageEntries = [];
    state.basePageWidth = 0;
    state.activePageNumber = 1;
    resetViewer("Upload a PDF to open a live preview.");
  }

  function zoomIn() {
    if (!state.pdfDocument) {
      return;
    }

    setScale(state.scale + 0.15, false);
  }

  function zoomOut() {
    if (!state.pdfDocument) {
      return;
    }

    setScale(state.scale - 0.15, false);
  }

  function fitWidth() {
    if (!state.pdfDocument) {
      return;
    }

    setScale(calculateFitWidthScale(), true);
  }

  function refreshLayout() {
    if (!state.pdfDocument) {
      return;
    }

    if (state.fitWidthActive) {
      setScale(calculateFitWidthScale(), true);
      return;
    }

    queueScrollSync();
  }

  function getViewState() {
    return {
      activePageNumber: state.activePageNumber,
      fitWidthActive: state.fitWidthActive,
      scale: state.scale,
      scrollTop: state.scrollPanelElement ? state.scrollPanelElement.scrollTop : 0
    };
  }

  function restoreViewState(viewState, behavior = "auto") {
    const normalizedViewState = normalizeViewState(viewState);
    if (!normalizedViewState || !state.scrollPanelElement || !state.pageEntries.length) {
      return false;
    }

    if (!normalizedViewState.fitWidthActive && Number.isFinite(normalizedViewState.scale)) {
      state.fitWidthActive = false;
      state.scale = clamp(normalizedViewState.scale, MIN_SCALE, MAX_SCALE);
      updateZoomLabel();
    }

    const targetEntry = state.pageEntries.find((entry) => entry.pageNumber === normalizedViewState.activePageNumber)
      || state.pageEntries[0];

    if (!targetEntry) {
      return false;
    }

    const maxScrollTop = Math.max(state.scrollPanelElement.scrollHeight - state.scrollPanelElement.clientHeight, 0);
    const targetScrollTop = clamp(Number(normalizedViewState.scrollTop) || targetEntry.shell.offsetTop, 0, maxScrollTop);
    state.scrollPanelElement.scrollTo({
      behavior,
      top: targetScrollTop
    });
    setActivePage(targetEntry.pageNumber);
    queueScrollSync();
    return true;
  }

  function focusPage(pageNumber, behavior = "smooth") {
    if (!state.pageEntries.length) {
      return;
    }

    const targetEntry = state.pageEntries.find((entry) => entry.pageNumber === pageNumber);
    if (!targetEntry) {
      return;
    }

    state.scrollPanelElement.scrollTo({
      behavior,
      top: Math.max(targetEntry.shell.offsetTop - 20, 0)
    });

    setActivePage(pageNumber);
  }

  function getActivePageNumber() {
    return state.activePageNumber;
  }

  function getPageCount() {
    return state.pageEntries.length;
  }

  function getPageOverlayElement(pageNumber) {
    return state.pageEntries.find((entry) => entry.pageNumber === pageNumber)?.overlayLayer ?? null;
  }

  function getPageDetectedTextLayerElement(pageNumber) {
    return state.pageEntries.find((entry) => entry.pageNumber === pageNumber)?.detectedTextLayer ?? null;
  }

  function getPageTextLayerElement(pageNumber) {
    return state.pageEntries.find((entry) => entry.pageNumber === pageNumber)?.textLayer ?? null;
  }

  function getPageSurfaceElement(pageNumber) {
    return state.pageEntries.find((entry) => entry.pageNumber === pageNumber)?.surface ?? null;
  }

  function bindEvents() {
    if (state.zoomOutButton) {
      state.zoomOutButton.addEventListener("click", zoomOut);
    }

    if (state.zoomInButton) {
      state.zoomInButton.addEventListener("click", zoomIn);
    }

    if (state.fitWidthButton) {
      state.fitWidthButton.addEventListener("click", fitWidth);
    }

    if (state.pageRailElement) {
      state.pageRailElement.addEventListener("click", (event) => {
        const button = event.target.closest("[data-page-number]");
        if (!button) {
          return;
        }

        const pageNumber = Number(button.dataset.pageNumber);
        if (Number.isInteger(pageNumber) && pageNumber > 0) {
          focusPage(pageNumber);
        }
      });

      state.pageRailElement.addEventListener("dragstart", (event) => {
        const button = event.target.closest("[data-page-number]");
        if (!button) {
          return;
        }

        state.draggedPageNumber = Number(button.dataset.pageNumber);
        button.classList.add("page-thumb--dragging");

        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(state.draggedPageNumber));
        }
      });

      state.pageRailElement.addEventListener("dragover", (event) => {
        const targetButton = event.target.closest("[data-page-number]");
        if (!targetButton || state.draggedPageNumber === null) {
          return;
        }

        event.preventDefault();
        state.pageRailElement.querySelectorAll(".page-thumb--drop-target").forEach((button) => {
          button.classList.remove("page-thumb--drop-target");
        });

        targetButton.classList.add("page-thumb--drop-target");
      });

      state.pageRailElement.addEventListener("dragleave", (event) => {
        const targetButton = event.target.closest("[data-page-number]");
        if (targetButton) {
          targetButton.classList.remove("page-thumb--drop-target");
        }
      });

      state.pageRailElement.addEventListener("drop", (event) => {
        const targetButton = event.target.closest("[data-page-number]");
        if (!targetButton || state.draggedPageNumber === null) {
          return;
        }

        event.preventDefault();
        const targetPageNumber = Number(targetButton.dataset.pageNumber);

        targetButton.classList.remove("page-thumb--drop-target");

        if (
          Number.isInteger(targetPageNumber) &&
          targetPageNumber > 0 &&
          targetPageNumber !== state.draggedPageNumber &&
          state.onPageOrderChanged
        ) {
          state.onPageOrderChanged(reorderPageNumbers(state.draggedPageNumber, targetPageNumber));
        }

        state.draggedPageNumber = null;
      });

      state.pageRailElement.addEventListener("dragend", () => {
        state.pageRailElement.querySelectorAll(".page-thumb--dragging, .page-thumb--drop-target").forEach((button) => {
          button.classList.remove("page-thumb--dragging", "page-thumb--drop-target");
        });
        state.draggedPageNumber = null;
      });
    }

    if (state.scrollPanelElement) {
      state.scrollPanelElement.addEventListener("scroll", queueScrollSync, { passive: true });
    }

    window.addEventListener("resize", () => {
      if (!state.pdfDocument || !state.fitWidthActive) {
        return;
      }

      setScale(calculateFitWidthScale(), true);
    });
  }

  function buildPageEntries(pageCount) {
    state.pagesElement.innerHTML = "";
    state.pageRailElement.innerHTML = "";
    state.pageEntries = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const pageShell = document.createElement("section");
      pageShell.className = "pdfjs-page-shell";
      pageShell.dataset.pageNumber = String(pageNumber);
      pageShell.innerHTML = `
        <div class="pdfjs-page-surface">
          <canvas class="pdfjs-page-canvas" aria-label="PDF page ${pageNumber}"></canvas>
          <div class="pdfjs-text-layer" data-page-text-layer="${pageNumber}"></div>
          <div class="pdfjs-detected-text-layer" data-page-text-layer="${pageNumber}"></div>
          <div class="pdfjs-annotation-layer" data-page-overlay="${pageNumber}"></div>
        </div>
        <div class="pdfjs-page-caption">Page ${pageNumber}</div>
      `;

      const thumbButton = document.createElement("button");
      thumbButton.className = "page-thumb page-thumb--viewer";
      thumbButton.type = "button";
      thumbButton.dataset.pageNumber = String(pageNumber);
      thumbButton.draggable = true;
      thumbButton.innerHTML = `
        <span class="page-thumb-preview">
          <canvas class="page-thumb-canvas" aria-hidden="true"></canvas>
        </span>
        <span class="page-thumb-label">Page ${pageNumber}</span>
      `;

      const entry = {
        pageNumber,
        shell: pageShell,
        canvas: pageShell.querySelector(".pdfjs-page-canvas"),
        textLayer: pageShell.querySelector(".pdfjs-text-layer"),
        detectedTextLayer: pageShell.querySelector(".pdfjs-detected-text-layer"),
        overlayLayer: pageShell.querySelector(".pdfjs-annotation-layer"),
        surface: pageShell.querySelector(".pdfjs-page-surface"),
        thumbButton,
        thumbCanvas: thumbButton.querySelector(".page-thumb-canvas"),
        textLayerTask: null
      };

      state.pageEntries.push(entry);
      state.pagesElement.appendChild(pageShell);
      state.pageRailElement.appendChild(thumbButton);
    }

    if (state.pageCountElement) {
      state.pageCountElement.textContent = String(pageCount);
    }
  }

  async function renderMainPages(loadSequence) {
    const renderGeneration = beginRenderGeneration();

    for (const entry of state.pageEntries) {
      if (loadSequence !== state.loadSequence || !state.pdfDocument || renderGeneration !== state.renderGeneration) {
        return;
      }

      const page = await state.pdfDocument.getPage(entry.pageNumber);
      const viewport = page.getViewport({ scale: state.scale });
      await renderCanvas(entry.canvas, page, viewport, renderGeneration);
      await renderTextLayer(entry, page, viewport, renderGeneration);
    }
  }

  async function renderThumbnails(loadSequence) {
    for (const entry of state.pageEntries) {
      if (loadSequence !== state.loadSequence || !state.pdfDocument) {
        return;
      }

      const page = await state.pdfDocument.getPage(entry.pageNumber);
      const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
      await renderCanvas(entry.thumbCanvas, page, viewport, state.renderGeneration);
    }
  }

  async function renderCanvas(canvas, page, viewport, renderGeneration) {
    const context = canvas.getContext("2d", { alpha: false });
    const outputScale = window.devicePixelRatio || 1;
    const width = Math.floor(viewport.width * outputScale);
    const height = Math.floor(viewport.height * outputScale);

    canvas.width = width;
    canvas.height = height;
    if (canvas.classList.contains("page-thumb-canvas")) {
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
    } else {
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.style.maxWidth = "";
    }

    const renderContext = {
      canvasContext: context,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
      viewport
    };

    const renderTask = page.render(renderContext);
    state.renderTasks.add(renderTask);

    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException" && renderGeneration === state.renderGeneration) {
        throw error;
      }
    } finally {
      state.renderTasks.delete(renderTask);
    }
  }

  function setScale(nextScale, fitWidthActive) {
    state.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    state.fitWidthActive = fitWidthActive;
    updateZoomLabel();

    const loadSequence = state.loadSequence;
    void renderMainPages(loadSequence).then(() => {
      if (fitWidthActive) {
        queueScrollSync();
      }
    }).catch((error) => {
      notifyError(error);
    });
  }

  function beginRenderGeneration() {
    state.renderGeneration += 1;
    cancelRenderTasks();
    return state.renderGeneration;
  }

  function cancelRenderTasks() {
    for (const renderTask of Array.from(state.renderTasks)) {
      try {
        renderTask.cancel();
      } catch (_error) {
      }
    }

    state.renderTasks.clear();
  }

  function cancelTextLayerTasks() {
    for (const textLayerTask of Array.from(state.textLayerTasks)) {
      try {
        textLayerTask.cancel();
      } catch (_error) {
      }
    }

    state.textLayerTasks.clear();

    for (const entry of state.pageEntries) {
      entry.textLayerTask = null;
      if (entry.textLayer) {
        entry.textLayer.innerHTML = "";
      }
    }
  }

  async function renderTextLayer(entry, page, viewport, renderGeneration) {
    if (!entry.textLayer) {
      return;
    }

    if (entry.textLayerTask) {
      try {
        entry.textLayerTask.cancel();
      } catch (_error) {
      }
      state.textLayerTasks.delete(entry.textLayerTask);
      entry.textLayerTask = null;
    }

    entry.textLayer.innerHTML = "";

    const textContent = await page.getTextContent();
    if (renderGeneration !== state.renderGeneration) {
      return;
    }

    const textLayerTask = new pdfjsLib.TextLayer({
      container: entry.textLayer,
      textContentSource: textContent,
      viewport
    });

    entry.textLayerTask = textLayerTask;
    state.textLayerTasks.add(textLayerTask);

    try {
      await textLayerTask.render();
      if (renderGeneration !== state.renderGeneration) {
        return;
      }

      entry.textLayer
        .querySelectorAll("span")
        .forEach((spanElement, index) => {
          spanElement.classList.add("pdfjs-text-span");
          spanElement.dataset.pageNumber = String(entry.pageNumber);
          spanElement.dataset.textSpanIndex = String(index);
        });
    } catch (error) {
      if (error?.name !== "AbortException" && error?.name !== "RenderingCancelledException" && renderGeneration === state.renderGeneration) {
        throw error;
      }
    } finally {
      state.textLayerTasks.delete(textLayerTask);
      if (entry.textLayerTask === textLayerTask) {
        entry.textLayerTask = null;
      }
    }
  }

  function calculateFitWidthScale() {
    if (!state.basePageWidth || !state.scrollPanelElement) {
      return DEFAULT_SCALE;
    }

    const availableWidth = Math.max(state.scrollPanelElement.clientWidth - 72, 320);
    return clamp(availableWidth / state.basePageWidth, MIN_SCALE, MAX_SCALE);
  }

  function queueScrollSync() {
    if (state.scrollFrame) {
      window.cancelAnimationFrame(state.scrollFrame);
    }

    state.scrollFrame = window.requestAnimationFrame(syncActivePageFromScroll);
  }

  function syncActivePageFromScroll() {
    if (!state.pageEntries.length || !state.scrollPanelElement) {
      return;
    }

    const activationEdge = state.scrollPanelElement.scrollTop + 96;
    let activeEntry = state.pageEntries[0];

    for (const entry of state.pageEntries) {
      if (entry.shell.offsetTop <= activationEdge) {
        activeEntry = entry;
        continue;
      }

      break;
    }

    setActivePage(activeEntry.pageNumber);
  }

  function setActivePage(pageNumber) {
    state.activePageNumber = pageNumber;
    updatePageIndicator();
    if (state.onActivePageChanged) {
      state.onActivePageChanged(pageNumber);
    }

    for (const entry of state.pageEntries) {
      const isActive = entry.pageNumber === pageNumber;
      entry.shell.classList.toggle("pdfjs-page-shell--active", isActive);
      entry.thumbButton.classList.toggle("page-thumb--active", isActive);
    }
  }

  function updateZoomLabel() {
    if (!state.zoomLevelElement) {
      return;
    }

    const zoomPercent = `${Math.round(state.scale * 100)}%`;
    state.zoomLevelElement.textContent = state.fitWidthActive ? `Fit width - ${zoomPercent}` : zoomPercent;
  }

  function updatePageIndicator() {
    if (!state.currentPageElement) {
      return;
    }

    const pageCount = state.pageEntries.length || 0;
    state.currentPageElement.textContent = `Page ${state.activePageNumber} / ${pageCount}`;
  }

  function normalizeViewState(viewState) {
    if (!viewState || typeof viewState !== "object") {
      return null;
    }

    const activePageNumber = Number(viewState.activePageNumber);
    const scrollTop = Number(viewState.scrollTop);
    const scale = Number(viewState.scale);

    return {
      activePageNumber: Number.isFinite(activePageNumber) && activePageNumber > 0 ? Math.round(activePageNumber) : 1,
      fitWidthActive: viewState.fitWidthActive !== false,
      scale: Number.isFinite(scale) ? scale : DEFAULT_SCALE,
      scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0
    };
  }

  function reorderPageNumbers(draggedPageNumber, targetPageNumber) {
    const orderedPageNumbers = state.pageEntries.map((entry) => entry.pageNumber);
    const draggedIndex = orderedPageNumbers.indexOf(draggedPageNumber);
    const targetIndex = orderedPageNumbers.indexOf(targetPageNumber);

    if (draggedIndex < 0 || targetIndex < 0) {
      return orderedPageNumbers;
    }

    const [draggedValue] = orderedPageNumbers.splice(draggedIndex, 1);
    orderedPageNumbers.splice(targetIndex, 0, draggedValue);
    return orderedPageNumbers;
  }

  function showDocument() {
    if (state.emptyStateElement) {
      state.emptyStateElement.hidden = true;
    }

    if (state.scrollPanelElement) {
      state.scrollPanelElement.hidden = false;
    }
  }

  function resetViewer(emptyMessage) {
    if (state.pageCountElement) {
      state.pageCountElement.textContent = "0";
    }

    if (state.currentPageElement) {
      state.currentPageElement.textContent = "Page 0 / 0";
    }

    if (state.zoomLevelElement) {
      state.zoomLevelElement.textContent = "100%";
    }

    if (state.emptyStateElement) {
      state.emptyStateElement.hidden = false;
      state.emptyStateElement.textContent = emptyMessage;
    }

    if (state.scrollPanelElement) {
      state.scrollPanelElement.hidden = true;
      state.scrollPanelElement.scrollTop = 0;
    }

    if (state.pagesElement) {
      state.pagesElement.innerHTML = "";
    }

    if (state.pageRailElement) {
      state.pageRailElement.innerHTML = '<div class="page-thumb empty-thumb">Upload a PDF to load page thumbnails.</div>';
    }
  }

  function destroyLoadingTask() {
    if (state.loadingTask) {
      state.loadingTask.destroy();
      state.loadingTask = null;
    }
  }

  function notifyError(error) {
    if (state.onError) {
      state.onError(error);
    }
  }
}

function appendCacheBust(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}viewer=${Date.now()}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function resolveElement(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return document.getElementById(value);
  }

  return value;
}

async function destroyPdfDocument(pdfDocument) {
  if (!pdfDocument) {
    return;
  }

  try {
    await pdfDocument.destroy();
  } catch (error) {
    // Ignore cleanup errors on replacement.
  }
}

