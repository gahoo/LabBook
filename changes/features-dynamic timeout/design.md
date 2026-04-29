# Design: Dynamic Notification Timeout

## Goal
Replace the fixed 1-minute cron job (`cron.schedule('* * * * *', ...)`) for the notification processing queue with a dynamic timeout scheduler. This ensures the queue is processed immediately when there are pending actions, or exactly when retries are due, without polling the database every minute when empty.

## Current Behavior & Issues
1. **Inefficiency:** `server.ts` uses node-cron to invoke `processNotificationQueue(db)` every minute. If the queue is empty, this needlessly queries the database.
2. **Date Formatting Bug in Retries:** `next_retry_time <= CURRENT_TIMESTAMP` is used for selecting due notifications. When a retry is scheduled, `next_retry_time` is updated to a string from `new Date().toISOString()` (e.g., `2026-04-29T...Z`). Because SQLite's `CURRENT_TIMESTAMP` uses space as a separator (`2026-04-29 00:00:00`), `T` (ASCII 84) > ` ` (ASCII 32), meaning retries might get incorrectly delayed if compared lexicographically.

## Proposed Changes

### 1. `server.ts`
- Remove the `cron.schedule` block that triggers `processNotificationQueue(db)` every minute.
- Keep the initial `processNotificationQueue(db).catch(console.error);` when the server starts to handle any events stored in the database while offline.

### 2. `src/services/notificationService.ts`
- **Global Variables:** Add `let nextRunTimer: NodeJS.Timeout | null = null;` to keep track of the scheduled run.
- **Dynamic Scheduler (`scheduleNextRun`):**
  - Create a function `scheduleNextRun(db)`. It queries the DB for the oldest pending/retrying task to determine when the next execution is due:
    ```sql
    SELECT strftime('%s', next_retry_time) AS next_sec 
    FROM notifications 
    WHERE status IN ('pending', 'retrying') 
    ORDER BY next_retry_time ASC LIMIT 1
    ```
  - It will clear any existing `nextRunTimer`.
  - Calculate `delay = (next_sec * 1000) - Date.now()`.
  - If `delay <= 0`, execute immediately. 
  - If `delay > 0`, schedule using `nextRunTimer = setTimeout(() => processNotificationQueue(db), delay)`.
- **Refactoring `processNotificationQueue`:**
  - Clear `nextRunTimer` at the start of `processNotificationQueue`.
  - Add a `finally` block to call `scheduleNextRun(db)` when the loop breaks (meaning no *currently* due tasks are left).
  - Use SQLite's datetime functions to ensure consistent timestamp formatting during backoffs:
    `db.prepare("UPDATE ... next_retry_time = datetime('now', '+' || ? || ' seconds')").run(backoffTimeMs / 1000, ...)` instead of Node's `.toISOString()`.
- **Fix existing timestamp anomaly:** 
  - Change `next_retry_time <= CURRENT_TIMESTAMP` to `strftime('%s', next_retry_time) <= strftime('%s', 'now')`.

## Conclusion
This dynamic approach ensures we only process the database when there's work to do, reducing load and handling retries accurately.
