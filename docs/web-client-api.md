# Web Client API

This document is for the Web user client. It shares the same public API contract as the Android client.

## Swagger routes

- `/docs/web`
- `/openapi/web.json`

## Main flow

- Login / register / refresh token
- Fetch visible workflows
- Fetch workflow inputs for dynamic forms
- Submit tasks
- Poll task status
- Read task history
- Delete own tasks / resources
- Read credits and logs

## Notes

- Do not hardcode workflow names or parameter keys in the Web client.
- Render the form from `GET /api/v1/workflows/{slug}/inputs`.
- Treat the server response as the source of truth for visible inputs.
- `GET /api/v1/tasks` is the current user's own task list.
- This document is only for the user client. Do not include admin/management APIs here.
