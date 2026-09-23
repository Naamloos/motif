import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from 'nw'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'release')
const runtime = path.join(root, 'node_modules', 'nw', 'nwjs-v0.116.0-win-x64')

await get({
  version: '0.116.0',
  flavor: 'normal',
  platform: 'win',
  arch: 'x64',
  downloadUrl: 'https://dl.nwjs.io',
  manifestUrl: 'https://nwjs.io/versions.json',
  cacheDir: path.join(root, 'node_modules', 'nw'),
  cache: true,
  ffmpeg: false,
  nativeAddon: false,
  shaSum: true,
})

await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
await fs.cp(runtime, output, { recursive: true })

const app = JSON.parse(await fs.readFile(path.join(root, '.nw-dev', 'package.json'), 'utf8'))
app.main = 'index.html'
delete app['node-remote']

const appDirectory = path.join(output, 'package.nw')
await fs.mkdir(appDirectory)
await fs.cp(path.join(root, 'dist'), appDirectory, { recursive: true })
await fs.writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify(app, null, 2)}\n`)

await fs.rename(path.join(output, 'nw.exe'), path.join(output, 'Motif.exe'))
