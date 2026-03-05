# GitHub Pages setup

This repository is configured to deploy to **GitHub Pages** automatically using GitHub Actions.

## What is included

- `index.html` – the webpage content.
- `.github/workflows/deploy-pages.yml` – deploys the site whenever code is pushed to `main`.

## One-time repo setting

In GitHub:
1. Go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

After that, every push to `main` will auto-deploy the site.
