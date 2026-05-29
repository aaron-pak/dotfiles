# Plan: Add CSV export to the reports page

## Goal
Let users download any report table as a CSV file from the reports page.

## Steps
1. Add an "Export CSV" button to the report toolbar, right of the date filter.
2. Serialize the currently filtered rows (not the full dataset) to CSV on the client.
3. Trigger a browser download named report-<date>.csv.
4. Show a toast when the export starts and when it completes.

## Open questions
- Should we include hidden columns in the export, or only the visible ones?
- Do we need a server-side export for very large reports (over 50k rows)?

## Out of scope
- Excel (.xlsx) export.
- Scheduled or emailed exports.
