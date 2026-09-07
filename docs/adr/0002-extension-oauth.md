# Authorize the first-party extension with OAuth 2.1

The Web application authorizes the fixed-ID extension through Supabase OAuth 2.1 Authorization Code with PKCE. The integration stays behind an extension Auth adapter because the Supabase OAuth Server is a beta dependency; application and domain interfaces do not depend on its token or endpoint shapes.
