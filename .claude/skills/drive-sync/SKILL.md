---
name: drive-sync
description: Sync each Mondo project's Google Drive folder into Mondo's local database using the Google Drive connector. Use when asked to "sync Drive", "update the knowledge base from Drive", or /drive-sync.
---

# Drive sync

Mondo mirrors one Google Drive folder per project into `data/mondo.db`, so its knowledge base can list and show Drive docs. Mondo can't reach Drive itself. **You** read Drive through the Google Drive connector (tools named like `mcp__<id>__search_files`, `mcp__<id>__read_file_content`), then hand the result to Mondo's import CLI.

**Read-only toward Drive.** Never create, edit, move, rename, share or delete Drive files during a sync.

Run all commands from the Mondo repo root (the folder containing `mondo.config.json`).

## Steps

1. **See what Mondo has:**
   ```bash
   npm run -s drive:status
   ```
   This prints JSON, one entry per project: `folder` (Drive folder name from `mondo.config.json` → `knowledge.drive.folder`), `folderId` (if known), and `known` (files already stored, with `id`, `modifiedTime`, `hasContent`). Skip projects whose `folder` is null.

2. **Find the folder** (only if `folderId` is null):
   use `search_files` with query
   `title = '<folder>' and mimeType = 'application/vnd.google-apps.folder'` (exact title match).
   - **None found:** record a failed sync (step 5) with `error: "Drive folder '<folder>' not found"`, then move on.
   - **Several found:** prefer the one owned by the user in My Drive. Mention the ambiguity in your report.
   - Tell the user the id, so they can pin it as `knowledge.drive.folderId`.

3. **List everything inside, recursively:**
   use `search_files` with `parentId = '<folderId>'` (set `excludeContentSnippets: true`, follow `next_page_token`).
   - For each child folder (`mimeType = application/vnd.google-apps.folder`), list it the same way, up to 4 levels deep.
   - Track each file's `folderPath`: the folder names below the project folder joined with `/`, or `""` at the top level.
   - Skip folders themselves, shortcuts and trashed items.

4. **Fetch text only where needed.** For each file:
   - **New or changed** (not in `known`, or its `modifiedTime` differs, or `hasContent` is false): if its `mimeType` is one `read_file_content` supports (Google Docs/Slides/Sheets, PDF, Word, etc.), call `read_file_content` and use the returned text as `content`. If reading fails, leave `content` out and note it.
   - **Unchanged:** leave `content` out. Mondo keeps the stored text.
   - **Images and other binaries:** leave `content` out. They're listed as links only.

5. **Write one payload per project** to a JSON file in your scratchpad (or the system temp dir), then import:
   ```json
   {
     "project": "EQX-Net",
     "folderId": "<folder id>",
     "complete": true,
     "files": [
       {
         "id": "<file id>",
         "title": "<title>",
         "mimeType": "<mimeType>",
         "url": "<viewUrl>",
         "folderPath": "Plans",
         "modifiedTime": "<modifiedTime>",
         "contentFile": "<file id>.md"
       }
     ]
   }
   ```
   For new/changed docs, save the text from `read_file_content` **exactly as returned** to a `.md` file next to the payload, and reference it with `contentFile` (a path relative to the payload). This avoids escaping long text inside JSON. Inline `"content": "..."` also works for short text. Leave both out for unchanged files.
   ```bash
   npm run -s drive:import -- <payload.json> [more payloads…]
   ```
   - **`complete`:** set it to `true` only when the listing really is complete (no listing errors). With `true`, files Mondo has that are missing from `files` get marked as removed.
   - **Failed sync:** for a project that failed entirely, import `{ "project": "...", "error": "<what went wrong>" }` instead. It shows on Mondo's Settings page.

6. **Report** per project: the counts printed by the import (new / updated / removed), and anything skipped or ambiguous. Mondo shows the changes on the next page load (Knowledge base → project).

## Notes
- **Mondo doesn't need to be running:** the import writes straight to SQLite.
- **No connector:** if the session has no Google Drive connector, stop and say so. Don't import an error for every project in that case, because nothing about the folders is known.
- **Payload format:** see `lib/drive.ts` (`DriveImportPayload`).
