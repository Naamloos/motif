# Motif

Motif is a desktop LLM harness for chatting with local and hosted language models. It supports multiple model providers, workspace-aware tools, image attachments, saved chats and memories, and MCP servers.

Motif includes built-in support for LM Studio, Ollama, OpenAI, Anthropic, OpenRouter, and Codex CLI. LM Studio is configured as the default provider.

## Running Motif

Requirements:

- Node.js 22.12 or newer
- npm
- A running model provider or API credentials for a hosted provider

Install the dependencies and start the development app:

```sh
npm install
npm run dev
```

The app opens in an NW.js desktop window. Configure models, API credentials, tools, and MCP servers from Settings.

## Building Motif

Create a production build:

```sh
npm run build
```

The compiled application assets are written to `dist/`.

Package the Windows desktop app with NW.js:

```sh
npm run build:desktop
```

The runnable app is written to `release/Motif.exe` with its NW.js runtime alongside it.

## Screenshots

<p align="center">
  <img width="1000" height="773" alt="Motif chat interface" src="https://github.com/user-attachments/assets/3a5e9c15-3335-4b80-b023-26813f7aaff1" />
</p>
