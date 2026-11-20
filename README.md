# LinkedIn Message Writer

Open a LinkedIn profile, click Scan, get 3 personalized drafts (connection note or DM). Uses your own Gemini API key.

## Install (each person does this once)

1. Unzip the folder somewhere you won't delete it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `linkedin-writer` folder.
4. Pin the extension and click its icon. The side panel opens.
5. **Settings** tab: paste a Gemini API key from https://aistudio.google.com/apikey
6. **My profile** tab: open your own LinkedIn profile, click "Fill background from my LinkedIn", then add what you're looking for and your links.

## Use

1. Open a recruiter's profile.
2. Click **Scan this profile**. Check the ✓/✗ list. If something is missing, open "View / edit scanned text" and paste it in.
3. Pick type, goal, tone. Add a role or job link if you have one.
4. **Generate**, edit, **Copy**, paste into LinkedIn yourself.

Connection notes are capped at 300 characters. The counter turns red if a draft goes over; click Shorten.

## Notes

- Nothing is sent automatically. You always paste and send yourself. Keep it that way: auto-sending and bulk actions are what get LinkedIn accounts restricted.
- Your key and profile live only in your browser's extension storage.
- If a model name stops working, change it in Settings.
- After editing the code, hit the reload icon on `chrome://extensions`.
