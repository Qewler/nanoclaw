---
name: printing
description: Print files on the host's network printer via CUPS. Main group only. Use when the user asks to print a document, file, or attachment.
---

# Printing

Print files on the host's network printer using the `mcp__nanoclaw__print_file` tool.

**Main group only** — this tool is unavailable from non-main groups.

## Supported formats

- PDF (best — send PDFs directly)
- Text files (.txt)
- Images (.png, .jpg, .jpeg)
- Office documents — convert to PDF first with LibreOffice for best results:
  ```bash
  libreoffice --headless --convert-to pdf --outdir /workspace/group/ /workspace/group/document.docx
  ```

## Usage

```
mcp__nanoclaw__print_file:
  file_path: /workspace/group/report.pdf
```

## Options

| Option | Description | Example |
|--------|-------------|---------|
| `printer` | Printer name (omit for default) | `Brother_HL_L2442DW` |
| `copies` | Number of copies (1-50) | `3` |
| `page_range` | Pages to print | `1-5` or `1,3,5-10` |
| `duplex` | Two-sided printing | `two-sided-long-edge` |
| `paper_size` | Paper size | `A4`, `Letter` |

## Examples

Print a PDF with defaults:
```
file_path: /workspace/group/invoice.pdf
```

Print 2 copies, double-sided, A4:
```
file_path: /workspace/group/report.pdf
copies: 2
duplex: two-sided-long-edge
paper_size: A4
```

## Workflow for email attachments

1. Download/save the attachment to `/workspace/group/`
2. If it's a DOC/DOCX/XLS/XLSX, convert to PDF with LibreOffice
3. Call `print_file` with the file path
4. A confirmation message is sent to the chat automatically
