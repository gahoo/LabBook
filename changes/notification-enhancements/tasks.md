# Tasks: Notification & UX Enhancements

This document breaks down the notification and UX enhancements proposed in `design.md` into smaller, independent tasks to ensure gradual and safe implementation.

## Task 1: Cleanup & Setup Settings Structure
- Delete the obsolete `test-sqlite.cjs` file.
- In `src/App.tsx` (Settings component):
  - Move the "系统管理员邮箱列表" (Admin Email List) field into the SMTP settings block.
  - Implement auto-save (immediate API call + Toast feedback) for all boolean switch toggles to prevent users from forgetting to save.

## Task 2: Webhook Alias & Delivery Logs
- In `src/App.tsx`: Add a text input for "Webhook 别名" (Webhook Alias, default: 'Webhook') to the Webhook settings block.
- In `server.ts`: Update the Delivery Logs API response to include the configured Webhook Alias, replacing the hardcoded "webhook" channel name.
- In `src/App.tsx`: Reflect the dynamically retrieved alias in the Delivery Logs table.

## Task 3: Template Formatting & BASE_URL
- In `server.ts`: During booking and other events, pass the current request's `BASE_URL` (computed from `req.protocol` and `req.headers.host`) down to the notification service.
- In `src/services/notificationService.ts`: 
  - Ensure `BASE_URL` is parsed and made available as a tag.
  - Format `start_time` and `end_time` logic so they are human-readable (e.g., `yyyy-MM-dd HH:mm`).
  - Pre-fill empty templates with sensible defaults, making sure to use "管理员" instead of "系统管理组".

## Task 4: Web Display Toggle & Backend Validation
- In `server.ts` Settings API (`POST /api/admin/settings`):
  - Handle the single `show_booking_code_on_web` toggle.
  - Implement validation: if `show_booking_code_on_web` is toggled off, check if (SMTP enabled AND new booking email notification enabled) OR (Webhook enabled AND new booking webhook notification enabled). If neither condition is met, return a validation error to prevent code loss.
- In `server.ts` Booking API (`POST /api/bookings`):
  - Respect `show_booking_code_on_web`. If false, don't return the raw code in the JSON response, or pass a flag to tell the frontend to hide it.

## Task 5: Frontend Booking Flow & URL Lookup
- In `src/App.tsx` (Reservation): Update the booking success dialog to respect `show_booking_code_on_web`. Do not append the code to the Cookie or show it in the UI if disabled.
- Update the success message text to say "您的预约码已通过 [webhook_alias]/邮件 发送" depending on active methods.
- In `src/App.tsx` (My Reservations): Support reading `?code=...` from the URL, automatically completing the code query, storing it in the Cookie, and removing it from the URL history.
