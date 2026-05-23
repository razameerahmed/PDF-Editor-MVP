import argparse
import json
import sys
from pathlib import Path


def configure_engine_path() -> None:
    repository_root = Path(__file__).resolve().parents[4]
    engine_source_root = repository_root / "apps" / "python" / "PdfEditor.DocumentEngine" / "src"
    engine_source_root_value = str(engine_source_root)
    if engine_source_root_value not in sys.path:
        sys.path.insert(0, engine_source_root_value)


configure_engine_path()

from pdf_editor_document_engine.models.text import ReplaceTextRequest, UpdateTextLayoutRequest
from pdf_editor_document_engine.services.text_engine import text_engine_service


def main():
    parser = argparse.ArgumentParser(description="Local PDF text detection and replacement tools.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser("extract", help="Extract detected text blocks from a PDF.")
    extract_parser.add_argument("--input", required=True, help="Absolute path to the input PDF file.")

    replace_parser = subparsers.add_parser("replace", help="Replace a detected text block in a PDF.")
    replace_parser.add_argument("--input", required=True, help="Absolute path to the input PDF file.")
    replace_parser.add_argument("--output", required=True, help="Absolute path to the output PDF file.")
    replace_parser.add_argument("--text-block-id", required=True, help="The detected text block identifier.")
    replace_parser.add_argument("--replacement-text", required=True, help="The replacement text.")

    place_parser = subparsers.add_parser("place", help="Move or duplicate detected PDF text in a PDF.")
    place_parser.add_argument("--input", required=True, help="Absolute path to the input PDF file.")
    place_parser.add_argument("--output", required=True, help="Absolute path to the output PDF file.")
    place_parser.add_argument("--text-block-id", required=True, help="The detected text block identifier.")
    place_parser.add_argument("--text", required=True, help="The text to place in the target rectangle.")
    place_parser.add_argument("--x", required=True, type=float, help="The normalized X coordinate.")
    place_parser.add_argument("--y", required=True, type=float, help="The normalized Y coordinate.")
    place_parser.add_argument("--width", required=True, type=float, help="The normalized width.")
    place_parser.add_argument("--height", required=True, type=float, help="The normalized height.")
    place_parser.add_argument("--keep-original", required=True, help="Whether to keep the original text block.")

    arguments = parser.parse_args()

    if arguments.command == "extract":
        payload = {
            "textBlocks": [
                text_block.model_dump(mode="json")
                for text_block in text_engine_service.extract_text_blocks(arguments.input)
            ]
        }
    elif arguments.command == "replace":
        payload = text_engine_service.replace_text(
            ReplaceTextRequest(
                sourcePath=arguments.input,
                outputPath=arguments.output,
                textBlockId=arguments.text_block_id,
                replacementText=arguments.replacement_text,
            )
        ).model_dump(mode="json")
    else:
        payload = text_engine_service.update_text_layout(
            UpdateTextLayoutRequest(
                sourcePath=arguments.input,
                outputPath=arguments.output,
                textBlockId=arguments.text_block_id,
                text=arguments.text,
                x=arguments.x,
                y=arguments.y,
                width=arguments.width,
                height=arguments.height,
                keepOriginal=arguments.keep_original.lower() == "true",
            )
        ).model_dump(mode="json")

    json.dump(payload, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
