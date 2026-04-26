### Printing files (`print_file`)

Use `mcp__nanoclaw__print_file({ file_path, printer?, copies?, pageRange?, duplex?, paperSize? })` to send a file to a physical printer attached to the host (CUPS / `lp`). Owner-only — non-owner sessions are silently dropped on the host.

- `file_path` must be an absolute path inside `/workspace/group/` (the agent's group folder is the only printable area).
- Pair with LibreOffice (`libreoffice --headless --convert-to pdf …`) when you need to print a non-PDF source: convert first, then print the PDF.
- Submission is fire-and-forget — the host validates, gates, and shells to `lp`. Confirm with the user that the print landed; don't assume success.
