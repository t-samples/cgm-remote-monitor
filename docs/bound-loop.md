# Recipient-bound Loop notifications

A caller can post to `/api/v2/notifications/loop/bound` with a dedicated, authenticated subject and one or more of the precise role permissions below. Do not give the subject `notifications:loop:push`, a wildcard equivalent, or an administrative role. Keep identity enrollment outside the request. This route creates no roles and enables no service automatically.

| Event type | Required permission |
| --- | --- |
| Temporary Override | `notifications:loop:override-set` |
| Temporary Override Cancel | `notifications:loop:override-cancel` |
| Remote Carbs Entry | `notifications:loop:carbs` |

The JSON body must contain `expectedRecipient` with the enrolled `bundleIdentifier` and lowercase `deviceTokenSha256`. The digest uses the exact UTF-8 device-token string. Keep real identifiers out of logs and source. The receiving server compares both against its current profile and uses a copy of that same recipient for its single APNs send. Each event has a separate field allowlist. Override selection must match one current preset. The bound route never accepts remote bolus. Legacy applications continue using their existing route and permission. A bound-only client must never retry on the legacy route.

HTTP 400 indicates invalid command fields, 403 indicates a denied credential or action, and 409 indicates an unconfirmed recipient or preset. These responses precede APNs dispatch on this route. HTTP 200 means APNs accepted the notification, with execution on the phone still unconfirmed. Treat a 5xx, network failure, or interruption as an uncertain outcome and reconcile before further commands. An old server lacking this route cannot service a bound-only client.

Use synthetic identities, mocked APNs and isolated databases for tests. Release, enrollment and verification with any real recipient are separate operator actions.
