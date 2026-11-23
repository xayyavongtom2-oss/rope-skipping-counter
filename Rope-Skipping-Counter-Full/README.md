# Rope Skipping Counter (Flask + MediaPipe Pose)

A Vietnamese dark-theme jump counter website. Pose detection runs in the browser; video is not uploaded to Flask.

## Requirements
- Python 3.10+ recommended
- A modern browser
- HTTPS for camera access on phones (localhost is allowed for local testing)

## Run on Windows
1. Extract the ZIP.
2. Install Python from python.org and enable "Add Python to PATH".
3. Open the project folder in File Explorer, click the address bar, type `cmd`, press Enter.
4. Run:
   ```bat
   py -m venv .venv
   .venv\\Scripts\\activate
   pip install -r requirements.txt
   py app.py
   ```
5. On your computer open `http://127.0.0.1:5000`.

## Camera on a phone
A phone cannot use the camera on a plain HTTP address served from another device. Deploy this project to a HTTPS host (Render, Railway, or another host) or use a HTTPS tunnel. Then open the HTTPS URL in Safari/Chrome and grant camera permission.

## How counting works / limitations
MediaPipe Pose Landmarker tracks body landmarks. The counter calibrates hip height for about 2 seconds, then detects a rise-and-return cycle using hip vertical displacement, a minimum airborne duration and cooldown to avoid double counting. It is a prototype heuristic: camera angle, loose clothing, lighting, framing and jumping style can affect accuracy. It does not visually track the rope itself, so it counts body jump cycles, not verified rope passes.

Workout history is stored in this browser's localStorage (not synced across devices). You can clear it from the History page.

## Structure
- `app.py`: Flask server
- `templates/index.html`: app UI
- `static/css/style.css`: styling
- `static/js/app.js`: camera, pose tracking, counter, session history and charts
