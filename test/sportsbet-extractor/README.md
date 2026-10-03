# Isolated Sportsbet card extractor trial

This folder is deliberately disconnected from the FPSO production loader, Supabase and Netlify Functions.

Run locally with Node 20+:

`node test/sportsbet-extractor/sportsbet-card-extractor.test.mjs`

Purpose:
- parse Sportsbet meeting race links;
- normalize race/runner identity;
- fail closed on missing/truncated/duplicate/malformed cards;
- disable Auto Generate whenever validation fails;
- reject runner-number or horse-name identity conflicts.

This is test-stage code only. It is not imported by index.html or any Netlify Function.
