# Payment retry integration

The NetSuite payment request must include `paymentInstructionId`: a stable ID for one payment part. The same value must be sent again when NetSuite retries the same request. Different partial payments on the same sales order must use different values, even if they have the same amount.

The supplied NetSuite script reads `custbody_ch_payment_instruction_id`. Replace that field ID with the custom body field in NetSuite that stores the unique payment instruction ID, then populate it before changing the order to `Shopify Ready To Charge`.

The application writes all charge results to `OrderSyncLog`. Cloud Scheduler reads new log rows in ID order and creates a `PaymentRetry` record only for `PAYMENT_CAPTURE` failures whose message indicates card decline or insufficient funds. It saves a cursor after every handled log, so duplicate logs are skipped by the unique payment key and old logs are not scanned again.
