# Spec: Rate limiting for the public API

## Behavior
The gateway **must** reject requests once a client exceeds its quota, returning a `429 Too Many Requests` status with a `Retry-After` header. Limits are tracked per `api_key` in a sliding 60-second window, as described in the [rate-limit RFC](https://example.com/rfc).

## Configuration
Each tier sets `requests_per_minute` and a `burst` allowance. The **enterprise** tier defaults to `6000` rpm with a `burst` of `1200`, while the **free** tier is capped at `60` rpm.

## Edge cases
- A request that arrives exactly at the window boundary counts toward the **next** window.
- If Redis is unavailable, the gateway fails **open** (allows the request) and logs a `rate_limit_degraded` event.
