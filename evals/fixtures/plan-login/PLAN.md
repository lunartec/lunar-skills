# Plan: passwordless login

Goal: get magic-link (passwordless) login working end to end on staging by tonight so QA can test tomorrow morning.

1. Research how three competitors design their login pages and write a comparison.
2. Add a `login_tokens` table (migration) storing hashed token, user id, expiry.
3. Build `POST /auth/magic-link` that creates a token and emails the link.
4. Build `GET /auth/verify?token=` that checks the token, expires it, and creates a session.
5. Wire the email provider (Postmark) with an API key from the secrets manager.
6. Create a plugin architecture so we can swap email providers later.
7. Design a dark-mode version of the email template.
8. Write one end-to-end test: request link, follow it, land logged in.
9. Refactor the legacy `UserService` into smaller services while we are in there.
10. Add a Grafana dashboard for login funnel metrics.
11. Write OpenAPI docs for the two new endpoints.
12. Prepare slides for Friday's product sync about the new login.
13. Update the company logo on the login page.
14. Deploy to staging and hand QA the test account.
