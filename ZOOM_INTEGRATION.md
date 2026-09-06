# Zoom Integration Implementation Guide

## Overview

This document outlines the setup and implementation of Zoom as a secure video conferencing platform for YanLearn courses. The system enforces enrollment verification, host privileges, and automatic meeting closure.

## Key Features

1. **Enrollment Verification**: Only enrolled students can join Zoom meetings
2. **Host Management**: Only the tutor can start/manage the meeting
3. **Automatic Name Enforcement**: Student names are registered as their YanLearn names
4. **Auto-Close Logic**: Meetings automatically close when the class ends and the host leaves
5. **Selective Adoption**: Only courses with first class date on/before June 24, 2026 (non-founder tutors) use this system. Founder-taught courses were on Schoolhouse until September 8, 2026 and are in Discord from then on -- see below.
6. **Discord Integration**: Only 5-minute reminders include the join link; others don't show Zoom details

## Founder-taught courses leaving Schoolhouse (September 8, 2026)

Courses taught by the founder trio ran on Schoolhouse rather than in Discord.
From **midnight Toronto time on 2026-09-08** (`founderSchoolhouseEndMs` in
`src/lib/discordLiveChannels.ts`) their classes use exactly the same Discord
infrastructure as everyone else's: a temporary live voice channel under the
"Live" category, tutor early access 15 minutes before, student access 5 minutes
before, attendance from voice states, absence follow-ups, and the recorder.

The cutoff is applied **per class, not per course**, so a founder course already
under way switches partway through: its classes before the date stay on
Schoolhouse and its classes after it are in Discord. That differs from the
Zoom-era rule (`courseUsesDiscordVoiceSystem`), which is decided once by a
course's first class, and both live behind one predicate,
`classUsesDiscordVoiceSystem`.

Nothing about this needs a migration or a backfill — it is a date rule, so it
takes effect on its own. What it touches:

* `class-reminders` cron — live voice channel creation, the reminder cadence,
  the reminder wording (Schoolhouse vs voice channel), and absence follow-ups.
* Enrollment approval emails — a student approved for a founder course is told
  about Discord or Schoolhouse based on the **next** class they will attend.
* `/api/courses/[courseId]/join` — no longer redirects a migrated class to
  Schoolhouse; it explains the class is in Discord.
* Analytics — founder courses stop being excluded from attendance-gap warnings
  once any of their classes falls after the cutoff.

Schoolhouse itself is untouched: `schoolhouse_course_id` still exists and old
classes still point at it, so past courses keep working.

## Setup Instructions

### 1. Zoom OAuth Setup

1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/)
2. Sign in with your Zoom account (founder account)
3. Create a new "Server-to-Server OAuth" app
4. Configure scopes: `meeting:write:admin`, `user:read:admin`
5. Get your credentials:
   - **Account ID** (also called Server-to-Server Account ID)
   - **Client ID**
   - **Client Secret**

### 2. Environment Variables

Add these to `.env.local`:

```env
ZOOM_ACCOUNT_ID="your_account_id"
ZOOM_CLIENT_ID="your_client_id"
ZOOM_CLIENT_SECRET="your_client_secret"
```

### 3. Database Migration

Run the migration to add Zoom fields:

```bash
supabase migration up
```

This adds:
- `zoom_meeting_id` - Zoom meeting ID
- `zoom_start_url` - Host URL (private)
- `zoom_join_url` - Participant URL
- `zoom_created_at` - When meeting was created
- Two new tables: `zoom_meeting_sessions` and `zoom_participant_links`

### 4. Install Dependencies

```bash
npm install jsonwebtoken jwt-decode
npm install --save-dev @types/jsonwebtoken
```

## System Architecture

### Meeting Creation Flow

```
Tutor clicks "Start Meeting"
    ↓
POST /api/courses/[courseId]/[classId]/meeting-status
    ↓
Check tutor authorization
    ↓
Create Zoom meeting via API
    ↓
Store meeting IDs in database
    ↓
Return start_url (with host token)
```

### Student Join Flow

```
Discord 5-min reminder with join link
    ↓
Click: /api/courses/[courseId]/join?classId=[classId]
    ↓
Verify authentication & enrollment
    ↓
Check if course uses new Zoom system
    ↓
If yes: Register as participant, return unique join URL
If no: Redirect to Schoolhouse
    ↓
Student joins with YanLearn name
```

### Auto-Close Flow

```
Cron job runs every minute
    ↓
Check all active meetings
    ↓
If class end time passed: Delete from Zoom API
    ↓
Mark meeting as ended in database
    ↓
Clear meeting IDs from course_classes
```

## API Endpoints

### POST `/api/courses/[courseId]/join`

**Purpose**: Gateway for students to join meetings

**Query Parameters**:
- `classId` (required) - Class ID to join

**Response** (if Zoom system):
```json
{
  "joinUrl": "https://zoom.us/...",
  "isHost": false,
  "userName": "John Doe"
}
```

**Response** (if Schoolhouse system):
```
HTTP 302 → https://www.schoolhouse.world/courses/[courseId]
```

### POST `/api/courses/[courseId]/[classId]/meeting-status`

**Purpose**: Create/start a Zoom meeting (tutor only)

**Headers**:
- `Authorization: Bearer [jwt_token]`

**Response**:
```json
{
  "meetingId": "123456789",
  "startUrl": "https://zoom.us/...",
  "joinUrl": "https://zoom.us/...",
  "password": "XXXX",
  "status": "created"
}
```

### GET `/api/courses/[courseId]/[classId]/meeting-status`

**Purpose**: Check if meeting should auto-close

**Response**:
```json
{
  "status": "active",
  "started": true,
  "ended": false,
  "shouldClose": false,
  "meetingId": "123456789",
  "endTime": "2026-06-25T14:00:00Z"
}
```

### DELETE `/api/courses/[courseId]/[classId]/meeting-status`

**Purpose**: End a meeting (host or automatic)

**Headers**:
- `Authorization: Bearer [jwt_token]`

**Response**:
```json
{
  "status": "ended"
}
```

### POST `/api/cron/auto-close-meetings`

**Purpose**: Automatic meeting closure cron job

**Headers**:
- `x-cron-secret: [CRON_SECRET]` OR `Authorization: Bearer [CRON_SECRET]`

**Response**:
```json
{
  "message": "Auto-close cron completed",
  "closedCount": 2,
  "totalChecked": 5
}
```

**Schedule**: Every minute via your cron service (e.g., Vercel Crons)

## Discord Integration

### Non-5-Minute Reminders (New Zoom System)

For courses using the new Zoom system, reminders at 24 hours, 6 hours, 1 hour, 15 minutes, and 10 minutes do NOT include Zoom details:

```
Your class starts in 1 hour.
Course: Python - Advanced
Class: Class 1
Tutor: John Doe
Start time (America/Toronto): June 25, 2026 at 2:00 PM

Please join 5 minutes before the class starts.
```

### 5-Minute Reminder (New Zoom System)

The 5-minute reminder includes the YanLearn join gateway link:

```
Your class starts in 5 minutes.
Course: Python - Advanced
Class: Class 1
Tutor: John Doe
Start time (America/Toronto): June 25, 2026 at 2:00 PM

Please join the meeting immediately:
https://yanlearn.ethanyanxu.com/api/courses/[courseId]/join?classId=[classId]
Your name will be set to your registered YanLearn name.
```

## Course Eligibility for New Zoom System

A course uses the new Zoom system if ALL of the following are true:

1. **Tutor is NOT a CEO** (email not in `NEXT_PUBLIC_FOUNDER_EMAIL`)
2. **First class date ≤ June 24, 2026**

Otherwise, the course continues using the Schoolhouse system.

## Name Enforcement

When a student joins a Zoom meeting:

1. The join link comes from the YanLearn gateway API
2. The gateway verifies the student's identity and enrollment
3. When registering the student for the meeting, their YanLearn full name is sent to Zoom
4. Zoom pre-populates their participant name with this value
5. Students may still be able to change it in the Zoom client, but it starts with their registered name

## Database Schema

### `course_classes` additions
```sql
zoom_meeting_id text
zoom_start_url text
zoom_join_url text
zoom_created_at timestamptz
```

### `zoom_meeting_sessions` (new table)
```sql
id uuid primary key
course_class_id uuid references course_classes
zoom_meeting_id text
host_user_id uuid references app_users
started_at timestamptz
ended_at timestamptz
created_at timestamptz
```

### `zoom_participant_links` (new table)
```sql
id uuid primary key
zoom_meeting_id text
student_id uuid references app_users
join_url text (unique per meeting per student)
used_at timestamptz
created_at timestamptz
```

## Security Considerations

1. **Start URLs are private**: Only stored in database, never exposed to students
2. **Join URLs are per-student**: Each student gets a unique registration link
3. **Enrollment verified**: Server checks payment and course enrollment before allowing access
4. **Host verification**: Only the tutor can start/manage meetings
5. **Auth tokens**: All API endpoints require JWT authentication

## Testing the Integration

### Test 1: Create a Meeting

```bash
curl -X POST https://yanlearn.ethanyanxu.com/api/courses/[courseId]/[classId]/meeting-status \
  -H "Authorization: Bearer [TUTOR_JWT]"
```

### Test 2: Check Meeting Status

```bash
curl https://yanlearn.ethanyanxu.com/api/courses/[courseId]/[classId]/meeting-status
```

### Test 3: Generate Student Join Link

```bash
curl "https://yanlearn.ethanyanxu.com/api/courses/[courseId]/join?classId=[classId]" \
  -H "Authorization: Bearer [STUDENT_JWT]"
```

### Test 4: Trigger Auto-Close

```bash
curl -X POST https://yanlearn.ethanyanxu.com/api/cron/auto-close-meetings \
  -H "x-cron-secret: [CRON_SECRET]"
```

## Troubleshooting

### Issue: "Missing Zoom OAuth credentials"
**Solution**: Verify `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` are set in `.env.local`

### Issue: "Not enrolled or payment pending"
**Solution**: Verify student is in `course_enrollments` table with `paid_at` timestamp

### Issue: Meeting never closes
**Solution**: Ensure cron job is configured to call `/api/cron/auto-close-meetings` every minute

### Issue: Students can't join
**Solution**: Check that course first class date is on/before June 24, 2026, and tutor is not a CEO

## Future Enhancements

1. Waiting room approval logic (currently disabled)
2. Recording management via Zoom API
3. Attendance tracking (who joined, when, how long)
4. Breakout room management
5. Participant video/audio enforcement
