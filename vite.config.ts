import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

const VIRTUAL_PREFIX = '\0nw-node:'

/**
 * Packages that should be loaded by NW.js at runtime instead of bundled by Vite.
 *
 * Node built-ins are always handled automatically, with or without `node:`.
 *
 * Only add packages here when they genuinely need Node/NW.js runtime behavior.
 */
const nwRuntimePackages = new Set<string>([
  '@ai-sdk/mcp',
  'playwright',
  'tesseract.js',
])

function isNwRuntimeImport(id: string): boolean {
  if (id.startsWith('node:') || nodeBuiltins.has(id)) {
    return true
  }

  const packageName = getPackageName(id)

  return nwRuntimePackages.has(packageName)
}

function getPackageName(id: string): string {
  if (id.startsWith('@')) {
    return id.split('/').slice(0, 2).join('/')
  }

  return id.split('/')[0]
}

function isValidExportName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    && name !== 'default'
}

function nwNodeImports(): Plugin {
  return {
    name: 'nw-node-imports',
    enforce: 'pre',

    resolveId(id) {
      if (!isNwRuntimeImport(id)) {
        return
      }

      return `${VIRTUAL_PREFIX}${id}`
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) {
        return
      }

      const moduleId = id.slice(VIRTUAL_PREFIX.length)

      /*
       * We load the module here only to discover its named exports.
       *
       * The actual module used by the application is loaded later by
       * NW.js through require().
       */
      const mod = require(moduleId)

      const exportNames = Object.keys(mod)
        .filter(isValidExportName)

      const namedExports = exportNames
        .map(
          name =>
            `export const ${name} = __nwModule[${JSON.stringify(name)}];`,
        )
        .join('\n')

      return `
const __nwRequire =
  typeof require !== 'undefined'
    ? require
    : globalThis.nw?.require;

if (!__nwRequire) {
  throw new Error(
    'NW.js require() is unavailable. This module must run inside NW.js.',
  );
}

const __nwModule = __nwRequire(${JSON.stringify(moduleId)});

const __nwDefault =
  __nwModule &&
  __nwModule.__esModule &&
  'default' in __nwModule
    ? __nwModule.default
    : __nwModule;

export default __nwDefault;

${namedExports}
`
    },
  }
}

export default defineConfig({
  base: './',

  plugins: [
    nwNodeImports(),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },

  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['ai-sdk-provider-codex-cli'],
  },
})
