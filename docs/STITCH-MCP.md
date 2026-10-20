# Google Stitch MCP setup for calc

The repository already contains a project-level Codex MCP configuration in `.codex/config.toml`.

It connects the MCP server named `stitch` to:

`https://stitch.googleapis.com/mcp`

Authentication is intentionally not stored in Git. The configuration maps the local environment variable `STITCH_API_KEY` to the `X-Goog-Api-Key` request header.

## One-time local setup

1. Open Stitch settings and create/copy an API key:
   https://stitch.withgoogle.com/settings

2. Put it in your local environment. Do not paste it into source code or commit it.

macOS/Linux, current terminal:

```sh
export STITCH_API_KEY='your-key'
```

For a persistent setup, store it in your preferred shell/secret manager rather than this repository.

3. Open this repository as a trusted Codex project, then start a new Codex session so project MCP settings are loaded.

4. Verify:

```sh
codex mcp list
```

The list should include `stitch`.

## Design project

- Project ID: `14138619381293668352`
- Project: https://stitch.withgoogle.com/projects/14138619381293668352

Ask Codex to read that project through Stitch MCP and implement its screens in the existing calculator while preserving all working functionality and tests.

## Troubleshooting

If `stitch` is listed but authentication fails:

- confirm `STITCH_API_KEY` exists in the environment that launched Codex;
- start a new Codex session after changing the environment variable;
- confirm the project is trusted so `.codex/config.toml` is loaded;
- never move the API key into `http_headers` in this public repository.

The Google Stitch SDK documents `STITCH_API_KEY` as an authentication method and the Stitch MCP endpoint as `https://stitch.googleapis.com/mcp`.
