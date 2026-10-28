# Payment retry scheduler

The app exposes `POST /api/payment-retries`. Protect it with the `PAYMENT_RETRY_CRON_SECRET` environment variable, set to a long random value in the app runtime and in Google Cloud Scheduler. The endpoint processes due database records only and uses the stored Shopify idempotency key for each attempt.

Create the daily job after deploying the app and applying Prisma migrations:

```sh
gcloud scheduler jobs create http payment-retry-daily \
  --location=YOUR_SCHEDULER_REGION \
  --schedule="0 7 * * *" \
  --time-zone="America/Los_Angeles" \
  --uri="https://YOUR_APP_HOST/api/payment-retries" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR_PAYMENT_RETRY_CRON_SECRET,Content-Type=application/json" \
  --message-body="{}"
```

Use the same secret value in `PAYMENT_RETRY_CRON_SECRET` and Scheduler. Restrict the secret to the Scheduler job and rotate it if it is exposed. The cron runs at 7:00 AM Pacific time year round; Cloud Scheduler applies PST/PDT changes through the IANA timezone.
