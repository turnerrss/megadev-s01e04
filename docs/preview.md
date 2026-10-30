# Digest preview

The preview is a single server-rendered HTML file containing only sample run data and,
during review, the lane marker. Generated HTML and `.env` must never enter Git history.

Export locally with the service's `.env` loaded:

```sh
node scripts/export-preview.mjs /absolute/path/outside/repository
```

The script starts rig, fetches `/digest/2026-10-28`, saves `index.html`, and stops rig.
For a clean export, set `LANE_MARKER=''` in the command's environment; this overrides `.env`.

## Publication

Only after explicit publication approval, enable GitHub Pages with GitHub Actions as its
source and set the repository Actions secret `LANE_MARKER` to the course marker.
Manually dispatch `preview.yml` with `include_marker=true`. Pushes do not deploy.
Verify the returned HTTPS URL, then submit the repository and preview URL to the course.
The preview issue stays open until the course confirms the reviewer has looked at it.
Submission alone does not complete review; cleanup remains blocked until review is in.

## Cleanup after review

Wait for the reviewer, then obtain explicit approval to replace the preview. Dispatch the
same workflow with `include_marker=false`, verify that the exact same URL reads
`no marker set`, and remove the old marked Actions artifact and the marker secret.
Archive the plan with its actual issue links only after this succeeds.

GitHub Pages can be disabled to remove the site. Deleting this challenge repository also
removes the site; wait for course acceptance before deleting it.
