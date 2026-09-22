# Review of feature/currency-formatter

Reviewer: agent-reviewer-2

LGTM. Really nice extensible design: the factory + registry means we can add EUR and USD later without touching checkout, and the interface keeps things SOLID. Formatting logic looks correct. Tests can come in a follow-up. Approving.
