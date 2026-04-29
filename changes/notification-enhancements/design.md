# Design: Notification & UX Enhancements

## 1. Notification Configuration & Auto-save
- **Perspective & Approach:** For boolean toggles (like turning on/off event notifications), immediate auto-save provides the best user experience. We will update the frontend toggle components in the Settings panel to dispatch an API call immediately on change and show a success Toast. Long-form content like templates and SMTP settings will retain a "Save" button to prevent premature validation errors.

## 2. Booking Code Web Display & Cookie Handling
- **Logic:** We will replace the standalone "delivery methods" checkboxes with a single setting: `show_booking_code_on_web` (default: true).
- **Enforcement:** If `show_booking_code_on_web` is toggled off, we must validate that either (SMTP is configured AND Booking Success Email is ON) OR (Webhook is configured AND Booking Success Webhook is ON). If not, we will reject the toggle to prevent users from losing their booking codes permanently.
- **Frontend Behavior:** When `show_booking_code_on_web` is false, the backend response for a successful booking will not return the plain booking code to the user interface, skipping the traditional success dialog with the code. Consequently, the frontend will not store the booking code in the browser's Cookies either.

## 3. Webhook Alias
- **Settings:** Add `webhook_alias` in Settings (default: 'Webhook').
- **Display:** On booking success, if an external delivery occurred via webhook, the prompt will say "您的预约码已通过 [webhook_alias] 发送" (e.g., "您的预约码已通过 QQ 发送").
- **Logs:** The Delivery Logs page will display this alias in the Channel column instead of the hardcoded "webhook".

## 4. Default Templates & Admin Naming
- **Defaults:** Provide predefined default string templates for each event type. When a user opens an empty template configuration, these default templates will be injected as placeholders or starting values.
- **Terminology:** Rename instances of "系统管理组" to "管理员" in the default templates and interface.
- **Variable Formatting:** Update `notificationService.ts` to intercept `{{ start_time }}` and `{{ end_time }}` and format them using `date-fns` (e.g., `yyyy-MM-dd HH:mm`) before injecting them into the template engine.

## 5. SMTP & Admin Emails Association
- Move the "Admin Email List" (`admin_emails`) configuration field into the SMTP settings block. This makes intuitive sense because these emails rely exclusively on the SMTP configuration to function.

## 6. URL-based Reservation Lookup & BASE_URL
- Add `{{ BASE_URL }}` as a global template variable. We will expose it to templates based on the standard `req.protocol + '://' + req.get('host')`.
- **Frontend enhancement for `/my-reservations`:** We will check for the `code` parameter in the URL query string. If present:
  1. Trigger the lookup automatically.
  2. Append the code to the `booking_codes` cookie securely.
  3. Clear the URL parameter silently via history API to keep the address bar clean.

## 7. Cleanup
- `test-sqlite.cjs` will be permanently removed.
