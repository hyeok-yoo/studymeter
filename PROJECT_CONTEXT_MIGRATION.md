# StudyMeter Project Context Migration
**Last Updated:** 2026-02-01 (v1.2 Update Completed)

## 📌 Project Overview
**App Name:** StudyMeter
**Goal:** A premium, "Liquid Glass" design focus-tracking app.
**Platform:** Web (React) + Android (Capacitor).

## 🛠 Tech Stack
- **Frontend:** React, Vite, TypeScript, Tailwind CSS, Framer Motion.
- **State/DB:** Dexie.js (IndexedDB wrapper) for local-first data.
- **Android:** Capacitor 7, Java (Native Modules).
- **Design System:** "Liquid Glass v4.0" (Blur 20px, Saturation 180%, Float animations).

## 🚀 Current Status: v1.2
The app has been updated to v1.2 with the following changes:

### 1. Records Tab UI Improvements
- **Default View:** Changed default view from "week" to "day" in Records page.
- **Time Format:** Bar chart now displays study time in "Xh Ym" format (e.g., "2h 30m") instead of minutes only.
- **Session Sorting:** Sessions are now sorted by startTime (chronological order) instead of insertion order.

### 2. Session Overlap Prevention
- **EditRecords.tsx:** When adding/editing a session that overlaps with an existing session, a warning dialog is shown. If user confirms, the existing session's end time is automatically adjusted.
- **StartStudyModal.tsx:** When starting the stopwatch, if there's an active session at current time, it is automatically adjusted (end time set to current time) without warning.

### 3. Utility Functions Added (db.ts)
- `formatDurationHourMinute(ms)`: Formats milliseconds to "Xh Ym" format.
- `findOverlappingSession(date, startTime, excludeId)`: Finds session overlapping at given time.
- `findActiveSessionAtTime(timestamp)`: Finds active session at given timestamp.
- `adjustOverlappingSession(sessionId, newEndTime)`: Adjusts session end time.

---

### Previous v1.1.2 Features (Retained)

#### Android 16-Style Live Update Notification (Now Bar)
- **Feature:** Shows a real-time timer in the Android status bar/notification shade while studying.
- **Implementation:**
    - **Native:** `StudyNotificationService.java` uses `Notification.Builder` with `.setUsesChronometer(true)` for battery-efficient updates.
    - **Bridge:** `LiveNotificationPlugin.java` exposes `start/stopLiveNotification` to Capacitor.
    - **Logic:** `Study.tsx` calculates the chronometer base time and triggers the native service via `NativeBridge.ts`.

#### UI/UX Improvements
- **EditRecords.tsx:** Fixed low contrast text in evaluation inputs for both Light/Dark modes.
- **Study.tsx (Selector):** `SlidingSelector` now only changes value on `PointerUp` (finger lift), preventing accidental changes during scrolling/dragging.

#### Logic Fixes
- **Timer Continuity:** Switching subjects in `Study.tsx` no longer resets the daily totals displayed.

## 📂 Key File Map
| File | Purpose |
|------|---------|
| `src/pages/Study.tsx` | Main timer logic + Live Notification hook. |
| `src/lib/NativeBridge.ts` | Bridge between React and Capacitor plugins. |
| `android/.../StudyNotificationService.java` | Foreground Service for Live Notification. |
| `android/.../LiveNotificationPlugin.java` | Capacitor Plugin implementation. |
| `src/index.css` | Liquid Glass design system definitions. |
| `src/lib/db.ts` | Dexie.js database schema & helpers. |

## 📝 Recent Context
- The user requested a "Master Prompt" to share with a friend, which was generated as `StudyMeter_Master_Prompt.txt`.
- The latest APK has been built: `android/app/build/outputs/apk/debug/app-debug.apk`.
- The user handles date/time strictly in **Local Timezone**.

## 📍 Next Steps for New Agent
1. **Load this context.**
2. **Resume work** based on user request (maintenance or new features).
3. **Note:** The "Live Notification" feature is native-heavy, so pay attention to `android/` directory changes if modifying timer logic.
