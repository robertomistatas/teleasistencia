import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { RuntimeError } from '../errors.js'
import type { LoadedManifest, SeedManifest } from '../types.js'

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeValue((value as Record<string, unknown>)[key])
        return accumulator
      }, {})
  }

  return value
}

function createManifestFingerprint(rawManifest: unknown): string {
  const normalized = JSON.stringify(normalizeValue(rawManifest))
  return createHash('sha256').update(normalized).digest('hex')
}

export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  const absolutePath = path.resolve(manifestPath)

  let fileContents: string
  try {
    fileContents = await readFile(absolutePath, 'utf8')
  } catch (error) {
    throw new RuntimeError('MANIFEST_READ_ERROR', 'Unable to read manifest file', {
      manifestPath: absolutePath,
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fileContents)
  } catch (error) {
    throw new RuntimeError('MANIFEST_PARSE_ERROR', 'Manifest JSON is invalid', {
      manifestPath: absolutePath,
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuntimeError('MANIFEST_ROOT_INVALID', 'Manifest root must be a single JSON object', {
      manifestPath: absolutePath,
    })
  }

  return {
    manifest: parsed as SeedManifest,
    manifestPath: absolutePath,
    manifestFingerprint: createManifestFingerprint(parsed),
  }
}