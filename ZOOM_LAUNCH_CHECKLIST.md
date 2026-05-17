# Zoom Integration Implementation Checklist

## Pre-Launch Checklist

### Phase 1: Zoom Account Setup (Complete Immediately)
- [ ] Create Zoom App at [Zoom App Marketplace](https://marketplace.zoom.us/)
- [ ] Select "Server-to-Server OAuth" app type
- [ ] Grant scopes: `meeting:write:admin`, `user:read:admin`
- [ ] Copy credentials (Account ID, Client ID, Client Secret)
- [ ] Add credentials to `.env.local`
- [ ] Test: Run `npm run dev` and verify no startup errors

### Phase 2: Database Migrations (Before Deployment)
- [ ] Review migration file: [supabase/migrations/20260517_add_zoom_meeting_fields.sql](supabase/migrations/20260517_add_zoom_meeting_fields.sql)
- [ ] Deploy migration to production Supabase
- [ ] Verify new tables exist:
  - `zoom_meeting_sessions`
  - `zoom_participant_links`
- [ ] Verify course_classes columns added:
  - `zoom_meeting_id`
  - `zoom_start_url`
  - `zoom_join_url`
  - `zoom_created_at`

### Phase 3: Code Deployment
- [ ] Deploy new files:
  - `src/lib/zoom.ts` - Zoom API client
  - `src/app/api/courses/[courseId]/join/route.ts` - Student join gateway
  - `src/app/api/courses/[courseId]/[classId]/meeting-status/route.ts` - Meeting management
  - `src/app/api/cron/auto-close-meetings/route.ts` - Auto-close cron
- [ ] Verify `package.json` includes: `jsonwebtoken`, `jwt-decode`
- [ ] Deploy updated files:
  - `src/app/api/cron/class-reminders/route.ts` - Discord reminder updates

### Phase 4: Cron Job Setup
- [ ] Set up cron service to call `/api/cron/auto-close-meetings` every minute
- [ ] **For Vercel**: Add to `vercel.json`:
  ```json
  {
    "crons": [
      {
        "path": "/api/cron/auto-close-meetings",
        "schedule": "* * * * *"
      }
    ]
  }
  ```
- [ ] Test: Manually call the endpoint to verify it works

### Phase 5: Testing
- [ ] Create a test course with first class date ≤ June 24, 2026
- [ ] Set a non-CEO tutor for this course
- [ ] **Tutor Test**: Can start a meeting
  - Visit: `/api/courses/[testCourseId]/[testClassId]/meeting-status` (POST)
  - Verify Zoom meeting is created
  - Verify URLs are stored in database
- [ ] **Student Test**: Can join with enrollment check
  - Enroll a student in the test course
  - Call: `/api/courses/[testCourseId]/join?classId=[testClassId]` (GET)
  - Verify student gets unique join URL
- [ ] **Unenrolled Student Test**: Cannot join
  - Try to join without enrollment
  - Verify 403 Forbidden response
- [ ] **Discord Reminder Test**:
  - Manually trigger class reminders cron
  - Verify non-5-minute reminders DON'T show Zoom details
  - Verify 5-minute reminder DOES show join link

### Phase 6: Verify Course Eligibility Logic
- [ ] Test Course #1: CEO tutor, first class ≤ June 24
  - **Result**: Should use Schoolhouse (not Zoom system)
- [ ] Test Course #2: Non-CEO tutor, first class > June 24
  - **Result**: Should use Schoolhouse (not Zoom system)
- [ ] Test Course #3: Non-CEO tutor, first class ≤ June 24
  - **Result**: Should use Zoom system ✓
- [ ] Test Course #4: CEO tutor, first class > June 24
  - **Result**: Should use Schoolhouse (not Zoom system)

### Phase 7: Student Name Enforcement
- [ ] Verify student's registered YanLearn name appears in Zoom
- [ ] Test with various name formats (spaces, special chars, etc.)

### Phase 8: Auto-Close Logic
- [ ] Create test class ending in past (completed)
- [ ] Trigger auto-close cron
- [ ] Verify meeting was deleted from Zoom
- [ ] Verify meeting marked as ended in database
- [ ] Verify zoom_* columns cleared from course_classes

### Phase 9: Production Monitoring
- [ ] Set up error logging for Zoom API failures
- [ ] Set up alerts for:
  - High rate of failed meeting creations
  - Auto-close cron failures
  - Enrollment verification failures
- [ ] Monitor Zoom API rate limits
- [ ] Document contact info for Zoom support

## Communication Checklist

### Notify Team
- [ ] Notify tutors: "New Zoom system rolling out for courses starting June 24 or before"
- [ ] Notify students: "You'll receive a special join link 5 minutes before class"
- [ ] Create FAQ: "How do I join Zoom with the new system?"

### Documentation
- [ ] Post [ZOOM_INTEGRATION.md](ZOOM_INTEGRATION.md) to team wiki
- [ ] Create troubleshooting guide
- [ ] Document escalation process for Zoom issues

## Rollback Plan

If critical issues arise:

1. **Immediate**: Revert Discord reminders to show Zoom details for all classes
   - Update: `src/app/api/cron/class-reminders/route.ts`
   - Remove check for `usesNewZoomSystem`
   - Restore old Zoom ID/password display

2. **Short-term**: Disable new endpoint and show error
   - Return 503 from: `/api/courses/[courseId]/join`
   - Redirect to Schoolhouse

3. **Full rollback**: 
   - Disable Zoom OAuth credentials
   - Delete new tables (backup first!)
   - Revert all file changes

## Success Metrics

Track these to verify successful rollout:

- [ ] 95%+ of students successfully join first attempt
- [ ] 0 unauthorized access attempts
- [ ] 99%+ of meetings auto-close as expected
- [ ] < 5% of Zoom API calls fail
- [ ] No student complaints about name enforcement
- [ ] Discord reminders sent successfully to all courses

## Post-Launch (Month 1)

- [ ] Review all error logs
- [ ] Gather feedback from tutors and students
- [ ] Optimize rate limiting if needed
- [ ] Consider enabling features like:
  - Waiting room for anti-zoom-bombing
  - Recording auto-management
  - Attendance tracking

---

**Ready to launch?** Go through this checklist top-to-bottom. Each section is critical for a smooth rollout.
