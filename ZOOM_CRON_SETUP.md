# Setting Up the Auto-Close Meetings Cron Job

The auto-close meetings cron job is critical for automatically ending Zoom meetings when they should be closed. This document explains how to set it up.

## Requirements

- The job needs to run **every minute** to catch meetings that should close promptly
- It should use the same `CRON_SECRET` as other cron jobs

## Setup Instructions

### For Vercel Deployments

1. **Update `vercel.json`** to include the cron job:

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

The `"* * * * *"` schedule runs every minute (standard cron format).

2. **Deploy**:
```bash
vercel deploy --prod
```

3. **Verify in Vercel Dashboard**:
   - Go to Settings → Functions
   - Look for "auto-close-meetings" in the cron jobs list
   - Verify it shows "Scheduled"

### For Other Hosting (Node.js)

If not using Vercel, you can use a package like `node-cron`:

```bash
npm install node-cron
```

Then create `scripts/auto-close-meetings-cron.js`:

```javascript
const cron = require('node-cron');
const https = require('https');

// Run every minute
cron.schedule('* * * * *', async () => {
  const options = {
    hostname: 'yourdomain.com',
    path: '/api/cron/auto-close-meetings',
    method: 'POST',
    headers: {
      'x-cron-secret': process.env.CRON_SECRET,
      'Content-Length': 0
    }
  };

  https.request(options, (res) => {
    console.log(`Auto-close cron: ${res.statusCode}`);
  }).end();
});

console.log('Auto-close meetings cron started');
```

Then run:
```bash
node scripts/auto-close-meetings-cron.js &
```

### For AWS EventBridge + Lambda

1. Create a Lambda function that makes an HTTP POST to `/api/cron/auto-close-meetings`
2. Create an EventBridge rule with the schedule: `rate(1 minute)`
3. Target the Lambda function

### For Google Cloud Scheduler

1. Create a Cloud Function that calls `/api/cron/auto-close-meetings`
2. Set frequency: `* * * * *` (every minute)
3. Provide `CRON_SECRET` in headers

## Testing the Cron Job

### Local Testing

```bash
curl -X POST http://localhost:3000/api/cron/auto-close-meetings \
  -H "x-cron-secret: $CRON_SECRET"
```

Expected response:
```json
{
  "message": "Auto-close cron completed",
  "closedCount": 0,
  "totalChecked": 5
}
```

### Production Testing

1. Create a test class that ends 5 minutes ago
2. Create a Zoom meeting session for it
3. Call the cron endpoint
4. Verify the meeting was closed and deleted from Zoom

## Monitoring

### Set Up Alerts

Monitor the cron job execution:

**For Vercel**: Use Vercel Analytics to monitor function execution
```
- Track errors
- Track execution time
- Alert if function fails 3 times in a row
```

**For Custom Setup**: Add logging to see when meetings are closed

```javascript
console.log(`[${new Date().toISOString()}] Auto-closed meeting ${meetingId}`);
```

### Expected Behavior

- **No active meetings**: Response includes `"closedCount": 0`
- **Some meetings close**: Response includes `"closedCount": N` where N > 0
- **Missing CRON_SECRET**: Returns 401 Unauthorized
- **Database error**: Returns 500 with error message

## Troubleshooting

### Cron job not running

**Vercel**: 
- Check Vercel dashboard → Logs → Cron
- Look for `X-Vercel-Cron` header in requests

**Node.js**:
- Check if the process is still running: `ps aux | grep cron`
- Verify `CRON_SECRET` is set in environment

### Meetings not auto-closing

Check:
1. Is the cron job actually running?
   - Add logging to see execution times
   
2. Are there any active meetings?
   - Query: `SELECT * FROM zoom_meeting_sessions WHERE ended_at IS NULL`
   
3. Is the end time correctly calculated?
   - Verify: `starts_at + duration_hours = class end time`
   
4. Is Zoom API responding?
   - Check error logs for Zoom API failures
   - Verify OAuth credentials are fresh

### High error rate

Possible causes:
- Zoom API rate limit exceeded (300 req/min per account)
- Database connection issues
- Invalid OAuth tokens

**Solution**:
- Add exponential backoff retry logic
- Check Zoom API status
- Verify database connection pool

## Important Notes

⚠️ **The cron job is critical**: Without it, meetings will persist in Zoom even after class ends.

⚠️ **Must run every minute**: If it runs less frequently, there's a gap where meetings aren't checked.

⚠️ **No duplicate cleanup**: The deduplication logic only applies to the cron job itself, not to previous runs. If a meeting was somehow marked as ended and `started_at` was cleared, running the cron twice won't cause issues.

## Performance Considerations

The cron job:
- Fetches all active meetings (~1-10 per minute)
- Makes 1 API call to Zoom per meeting to close
- Updates database records
- Typical execution: 100-500ms

At scale (1000+ concurrent classes):
- Consider batching Zoom deletions
- Consider using async/await properly to parallelize
- Monitor API rate limits (300 req/min)

## Costs

- **Vercel**: Free tier includes 100 cron invocations
- **Zoom API**: Free (unlimited meeting deletions)
- **Database**: Minimal (1 query per minute, 1 update per closed meeting)

Total cost: ~$0/month for this cron alone.
