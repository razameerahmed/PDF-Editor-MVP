from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DocumentEngineModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=False,
    )


class TextPreviewSpanModel(DocumentEngineModel):
    text: str
    x: float
    width: float = 0.0
    fontSize: float
    fontName: str
    colorHex: str = "#000000"
    isBold: bool = False
    isItalic: bool = False


class TextPreviewLineModel(DocumentEngineModel):
    text: str
    x: float
    y: float
    baselineY: float | None = None
    fontSize: float
    fontName: str
    colorHex: str = "#000000"
    isBold: bool = False
    isItalic: bool = False
    spans: list[TextPreviewSpanModel] = Field(default_factory=list)


class TextPreviewBackgroundModel(DocumentEngineModel):
    x: float
    y: float
    width: float
    height: float
    colorHex: str = "#ffffff"
    opacity: float = 1.0


class TextGlyphModel(DocumentEngineModel):
    unicodeText: str = ""
    codePoint: int = 0
    glyphId: int = 0
    originX: float = 0.0
    originY: float = 0.0
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class DetectedTextBlockModel(DocumentEngineModel):
    textBlockId: str
    pageNumber: int
    text: str
    x: float
    y: float
    width: float
    height: float
    fontSize: float
    fontName: str
    colorHex: str = "#000000"
    isBold: bool = False
    isItalic: bool = False
    renderedFontSize: float | None = None
    lineHeightRatio: float = 1.15
    previewMode: str = "source"
    previewCoordinateSpace: str = "legacy-fitted"
    previewViewportWidth: float = 0.0
    previewViewportHeight: float = 0.0
    layoutContainerId: str = ""
    editableRunId: str = ""
    documentEditMode: str = "digital-text"
    pageEditMode: str = "digital-text"
    fontResourceName: str = ""
    fontPostScriptName: str = ""
    fontFamily: str = ""
    fontSource: str = ""
    fontResolutionStatus: str = "exact-source"
    editCapability: str = "exact-editable"
    saveCapability: str = "exact-save"
    toUnicodeAvailable: bool = False
    canEmbedForEditing: bool = True
    missingGlyphs: list[str] = Field(default_factory=list)
    glyphRun: list[TextGlyphModel] = Field(default_factory=list)
    layoutLines: list[str] = Field(default_factory=list)
    previewLines: list[TextPreviewLineModel] = Field(default_factory=list)
    previewBackgrounds: list[TextPreviewBackgroundModel] = Field(default_factory=list)


class TextBlockExtractionRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)


class TextBlockExtractionResponse(DocumentEngineModel):
    textBlocks: list[DetectedTextBlockModel]


class ReplaceTextRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    outputPath: str = Field(min_length=1)
    textBlockId: str = Field(min_length=1)
    replacementText: str
    fontName: str | None = None
    fontSize: float | None = None
    colorHex: str | None = None
    isBold: bool | None = None
    isItalic: bool | None = None


class ReplaceTextResponse(DocumentEngineModel):
    operationType: str = "text-replacement"
    sourceTextBlockId: str
    pageNumber: int
    originalText: str
    replacementText: str
    resultTextBlock: DetectedTextBlockModel | None = None


class UpdateTextLayoutRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    outputPath: str = Field(min_length=1)
    textBlockId: str = Field(min_length=1)
    text: str
    x: float
    y: float
    width: float
    height: float
    keepOriginal: bool
    fontName: str | None = None
    fontSize: float | None = None
    colorHex: str | None = None
    isBold: bool | None = None
    isItalic: bool | None = None


class UpdateTextLayoutResponse(DocumentEngineModel):
    operationType: str = "text-layout-update"
    sourceTextBlockId: str
    text: str
    pageNumber: int
    keepOriginal: bool
    resultTextBlock: DetectedTextBlockModel | None = None


class PreviewTextLayoutRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    textBlockId: str = Field(min_length=1)
    text: str
    x: float
    y: float
    width: float
    height: float
    fontName: str | None = None
    fontSize: float | None = None
    colorHex: str | None = None
    isBold: bool | None = None
    isItalic: bool | None = None


class PreviewTextLayoutResponse(DocumentEngineModel):
    operationType: str = "text-layout-preview"
    sourceTextBlockId: str
    text: str
    pageNumber: int
    resultTextBlock: DetectedTextBlockModel


class ResolveFontResourceRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    textBlockId: str = Field(min_length=1)
    fontName: str | None = None
    isBold: bool | None = None
    isItalic: bool | None = None


class ResolveFontResourceResponse(DocumentEngineModel):
    operationType: str = "font-resource"
    requestedFontName: str
    resolvedFontName: str
    fontFamily: str
    fontSource: str
    fontFormat: str
    contentType: str
    fontDataBase64: str
    sourceFontResourceName: str = ""
    sourceFontPostScriptName: str = ""
    sourceFontFamily: str = ""
    fontResolutionStatus: str = "exact-source"
    toUnicodeAvailable: bool = False
    canEmbedForEditing: bool = True
    editCapability: str = "exact-editable"
    saveCapability: str = "exact-save"
    missingGlyphs: list[str] = Field(default_factory=list)
    isFallback: bool = False
    warning: str | None = None


class TextOverlayCommitOperation(DocumentEngineModel):
    sourceTextBlockId: str = Field(min_length=1)
    text: str
    x: float
    y: float
    width: float
    height: float
    hideSourceOnCommit: bool = False
    fontName: str | None = None
    fontSize: float | None = None
    colorHex: str | None = None
    isBold: bool | None = None
    isItalic: bool | None = None
    fontResourceName: str | None = None
    fontPostScriptName: str | None = None
    fontFamily: str | None = None
    fontSource: str | None = None
    fontResolutionStatus: str | None = None
    editCapability: str | None = None
    saveCapability: str | None = None
    toUnicodeAvailable: bool | None = None
    canEmbedForEditing: bool | None = None
    missingGlyphs: list[str] = Field(default_factory=list)
    previewCoordinateSpace: str | None = None
    previewViewportWidth: float | None = None
    previewViewportHeight: float | None = None
    previewLines: list[TextPreviewLineModel] = Field(default_factory=list)


class TextOverlayCommitRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    outputPath: str = Field(min_length=1)
    operations: list[TextOverlayCommitOperation]


class TextOverlayCommitResponse(DocumentEngineModel):
    operationType: str = "text-overlay-commit"
    committedOverlayCount: int


class RunOcrRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)
    outputPath: str = Field(min_length=1)
    languageCode: str = Field(default="eng", min_length=2)
    pageRange: str | None = None
    deskew: bool = True
    forceOcr: bool = False


class RunOcrResponse(DocumentEngineModel):
    operationType: str = "ocr"
    languageCode: str
    pageRange: str | None = None
    deskew: bool
    forceOcr: bool
