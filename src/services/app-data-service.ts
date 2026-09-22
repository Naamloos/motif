import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dataFile = join(nw.App.dataPath, 'motif-data.json')
const settingsFile = join(nw.App.dataPath, 'motif-settings.json')

export function loadSettingsData(): unknown | null {
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8')) as unknown
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}

export function saveSettingsData(settings: unknown) {
  mkdirSync(nw.App.dataPath, { recursive: true })
  const temporaryFile = `${settingsFile}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(settings), 'utf8')
  renameSync(temporaryFile, settingsFile)
}

export async function loadAppData(): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8')) as unknown
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function saveAppData(data: unknown) {
  await mkdir(nw.App.dataPath, { recursive: true })
  const temporaryFile = `${dataFile}.tmp`
  await writeFile(temporaryFile, JSON.stringify(data), 'utf8')
  await rename(temporaryFile, dataFile)
}
