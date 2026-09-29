# Owl Weather

A responsive weather app with live data from [Open-Meteo](https://open-meteo.com/). Open-Meteo needs no API key, account, or payment. The default location is Boca Raton, FL (FAU).

## Features
- A greeting for Saskia that changes with the time of day
- Current conditions: temperature, feels like, humidity, wind, UV index, chance of rain, sunrise and sunset
- An hourly forecast for the next 24 hours and a 7-day forecast
- City search and a "my location" button
- A °F/°C toggle
- Light, Dark, and System themes, with the choice saved in the browser
- Layouts for desktop, tablet, and phone
- Refreshes every 10 minutes and whenever the tab becomes visible again

## Files
- `index.html`: the page
- `styles.css`: themes and responsive layout
- `app.js`: calls the Open-Meteo API and renders the forecast
- `netlify.toml`: Netlify config (static site, no build step)

## Run locally
Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy to Netlify
1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. Set the branch to deploy to `main`. Leave the build command empty and set the publish directory to `.`, which `netlify.toml` already specifies.
3. Click **Deploy**. Each push to `main` redeploys the site automatically.

You can also drag and drop this folder onto https://app.netlify.com/drop.
