# plugin-screener-mcp

Stock screener for [Jaspers Terminal](https://github.com/JaspersAI), an open source, extensible desktop terminal for financial research.

One view, `screener-mcp/screener`, on the Jaspers screener MCP server:

- **A table of US SEC registrants**, one row per company, filtered on any field of a company (latest-fiscal-year fundamentals, institutional holders from Form 13F, insiders from Forms 3/4/5) with filters of the form `{field, op, value}`, sorted by any column, limited to a list of your own tickers if you give one. A line over the table shows how many companies there are, how many each filter passes on its own, and how many pass all of them. The fields, their units and their comparisons come from the server, so the view has no list of its own.
- **Criteria in words.** Once the list is small enough (the server says how small), write criteria as yes/no questions ("Does the company depend on a sole-source supplier?") and run them: the server reads every company's newest 10-K and 10-Q against each criterion and answers pass, fail or unclear, with quotes it has verified. The table shows each company's verdict per criterion; opening a company shows the rationale and each quote as a citation with a link to the filing on sec.gov.

Ask the assistant for a screen ("software companies growing revenue over 20%") and it sets the filters; agree criteria with it and it sets those and starts the run. The open company's evidence is published as text with a marker (`[^id]`) after every quote, which the assistant uses to cite the quote in the chat.

## Install

In Jaspers Terminal, open Settings > Plugins, paste

```
https://github.com/JaspersAI/plugin-screener-mcp
```

and press Install. The app downloads the latest release, shows where it came from, and asks before any of it runs. A plugin runs code on your computer with your permissions, so install plugins only from people you trust.

## Needs

A Jaspers Screener account (sign up at https://s.jsprai.com/auth/signup). After installing, press Authorize in Settings > Plugins and sign in in the browser that opens. The plugin reaches the Jaspers screener MCP server at `https://s.jsprai.com/mcp`.

The earlier hosted server (`https://analyst-api.jsprai.com/mcp/open`, with a Jaspers API key) is [plugin-screener](https://github.com/JaspersAI/plugin-screener)'s. The two have different ids, `screener-mcp` and `screener`, so they install side by side; this repo shares that one's history up to 3.0.1.

## Develop

```sh
git clone https://github.com/JaspersAI/plugin-screener-mcp.git ~/Jaspers/plugins/screener-mcp
cd ~/Jaspers/plugins/screener-mcp
npm install
npm run typecheck
npm test
```

A folder you put in `~/Jaspers/plugins` is a plugin of your own, which the app rebuilds whenever you save. If this plugin is installed, remove it in Settings > Plugins first: the clone goes where the installed copy lives. Types come from [`@jaspers-ai/sdk`](https://www.npmjs.com/package/@jaspers-ai/sdk), which the app provides at run time.

## Release

Bump `version` in `package.json`, commit, and push a tag:

```sh
npm version patch
git push --follow-tags
```

The Release workflow checks the plugin and attaches `screener-mcp-<version>.zip` to a GitHub release. Update in Settings > Plugins picks it up.

## License

[MIT](LICENSE)
