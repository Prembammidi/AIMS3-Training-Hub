# AIMS3 Training Hub - V7 Simple Video List

This version keeps the V7 dashboard/course layout but simplifies the course video experience:

- Large course-video list appears above the player.
- Visible YouTube player is not created until a user chooses a video.
- Clicking a video loads that selected lesson in the embedded player.
- "Open selected video" always provides a direct YouTube fallback.
- "Open full course in YouTube" is always available even if playlist discovery is blocked.
- Official Microsoft Forms quiz links remain unchanged.
- No backend, database, API key, Python server, or login is required.

## Run
Open the folder in VS Code and use **Live Server**. Do not open course.html directly with file:// because YouTube can block embedded playback for pages without an HTTP/HTTPS origin.
